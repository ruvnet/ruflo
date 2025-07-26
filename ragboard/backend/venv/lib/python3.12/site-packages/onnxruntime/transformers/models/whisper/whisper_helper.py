# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation.  All rights reserved.
# Licensed under the MIT License.  See License.txt in the project root for
# license information.
# --------------------------------------------------------------------------

import logging
import os
from pathlib import Path

import numpy as np
import torch
from convert_generation import add_cache_indirection_to_mha, add_output_qk_to_mha, fix_past_sequence_length
from optimizer import optimize_model
from transformers import WhisperConfig, WhisperForConditionalGeneration, WhisperProcessor
from whisper_decoder import WhisperDecoder
from whisper_encoder import WhisperEncoder
from whisper_encoder_decoder_init import WhisperEncoderDecoderInit
from whisper_jump_times import WhisperJumpTimes

from onnxruntime import InferenceSession

logger = logging.getLogger(__name__)

PRETRAINED_WHISPER_MODELS = [
    "whisper-tiny",
    "whisper-tiny.en",
    "whisper-base",
    "whisper-base.en",
    "whisper-small",
    "whisper-small.en",
    "whisper-medium",
    "whisper-medium.en",
    "whisper-large",
    "whisper-large-v2",
    "whisper-large-v3",
    "whisper-large-v3-turbo",
]


class WhisperHelper:
    @staticmethod
    def get_onnx_path(
        output_dir: str,
        model_name_or_path: str,
        suffix: str = "",
        new_folder: bool = False,
    ) -> str:
        """Build onnx path

        Args:
            output_dir (str): output directory
            model_name_or_path (str): pretrained model name, or path to the model checkpoint
            suffix (str, optional): suffix like "_encoder" or "_decoder_fp16" will be appended to file name. Defaults to None.
            new_folder (bool, optional): create a new directory for the model. Defaults to False.
        Returns:
            str: path of onnx model
        """
        model_name = model_name_or_path
        if os.path.isdir(model_name_or_path):
            model_name = Path(model_name_or_path).parts[-1]
        else:
            model_name = model_name.split("/")[-1]

        model_name += suffix

        directory = os.path.join(output_dir, model_name) if new_folder else output_dir
        return os.path.join(directory, model_name + ".onnx")

    @staticmethod
    def load_model(
        model_name_or_path: str,
        model_impl: str,
        cache_dir: str,
        device: torch.device,
        dtype: torch.dtype,
        merge_encoder_and_decoder_init: bool = True,
        no_beam_search_op: bool = False,
        output_qk: bool = False,
    ) -> dict[str, torch.nn.Module]:
        """Load model given a pretrained name or path, then build models for ONNX conversion.

        Args:
            model_name_or_path (str): pretrained model name or path
            model_impl (str): library to load model from
            cache_dir (str): cache directory
            device (torch.device): device to run the model
            dtype (torch.dtype): dtype to run the model
            merge_encoder_and_decoder_init (bool, optional): Whether merge encoder and decoder initialization into one ONNX model. Defaults to True.
            no_beam_search_op (bool, optional): Whether to use beam search op or not. Defaults to False.
            output_qk (bool, optional): Whether to output QKs to calculate batched jump times for word-level timestamps. Defaults to False.
        Returns:
            Dict[str, torch.nn.Module]: mapping from name to modules for ONNX conversion.
        """
        # Load PyTorch model
        if model_impl == "hf":
            # Load from Hugging Face
            model = WhisperForConditionalGeneration.from_pretrained(
                model_name_or_path, cache_dir=cache_dir, attn_implementation="eager"
            )
        else:
            # Load from OpenAI
            import whisper

            if not os.path.exists(model_name_or_path):
                name_or_path = model_name_or_path.split("/")[-1][8:]
            else:
                name_or_path = model_name_or_path
            model = whisper.load_model(name_or_path, device, download_root=cache_dir, in_memory=True)

        # Set PyTorch model properties
        model.eval().to(device=device)
        if model_impl == "hf":
            model.to(dtype=dtype)
        config = WhisperConfig.from_pretrained(model_name_or_path, cache_dir=cache_dir)

        # Load each component of PyTorch model
        decoder = WhisperDecoder(config, model, model_impl, no_beam_search_op).eval()
        components = {"decoder": decoder}
        if merge_encoder_and_decoder_init:
            encoder_decoder_init = WhisperEncoderDecoderInit(config, model, model_impl, no_beam_search_op).eval()
            components.update({"encoder": encoder_decoder_init})
        else:
            encoder = WhisperEncoder(config, model, model_impl).eval()
            components.update({"encoder": encoder, "decoder_init": decoder})

        if output_qk:
            batched_jump_times = WhisperJumpTimes(config, device, cache_dir).eval()
            components.update({"jump_times": batched_jump_times})
        return components

    @staticmethod
    def export_onnx(
        model: WhisperEncoder | WhisperEncoderDecoderInit | WhisperDecoder,
        onnx_model_path: str,
        provider: str,
        verbose: bool,
        use_external_data_format: bool,
        use_fp16_inputs: bool,
        use_int32_inputs: bool,
        use_encoder_hidden_states: bool,
        use_kv_cache_inputs: bool,
    ):
        """Export model component to ONNX

        Args:
            model (class): PyTorch class to export
            onnx_model_path (str): path to save ONNX model
            provider (str): provider to use for verifying parity on ONNX model
            verbose (bool): print verbose information.
            use_external_data_format (bool): use external data format or not.
            use_fp16_inputs (bool): use float16 inputs for the audio_features, encoder_hidden_states, logits, and KV caches.
            use_int32_inputs (bool): use int32 inputs for the decoder_input_ids.
            use_encoder_hidden_states (bool): use encoder_hidden_states as model input for decoder-init/decoder-without-past models.
            use_kv_cache_inputs (bool): use KV caches as model inputs for decoder-with-past models.
        """
        if isinstance(model, WhisperEncoder):
            model.export_onnx(
                onnx_model_path,
                provider,
                verbose,
                use_external_data_format,
                use_fp16_inputs,
            )
        elif isinstance(model, WhisperEncoderDecoderInit):
            model.export_onnx(
                onnx_model_path,
                provider,
                verbose,
                use_external_data_format,
                use_fp16_inputs,
                use_int32_inputs,
            )
        elif isinstance(model, WhisperDecoder):
            model.export_onnx(
                onnx_model_path,
                provider,
                verbose,
                use_external_data_format,
                use_fp16_inputs,
                use_int32_inputs,
                use_encoder_hidden_states,
                use_kv_cache_inputs,
            )
        elif isinstance(model, WhisperJumpTimes):
            model.export_onnx(
                onnx_model_path,
                provider,
                verbose,
                use_external_data_format,
                use_fp16_inputs,
                use_int32_inputs,
            )
        else:
            raise ValueError(f"Unknown instance for model detected: {type(model)}")

    @staticmethod
    def optimize_onnx(
        onnx_model_path: str,
        optimized_model_path: str,
        is_float16: bool,
        num_attention_heads: int,
        hidden_size: int,
        num_layers: int,
        use_external_data_format: bool = False,
        use_gpu: bool = False,
        provider: str = "cpu",
        is_decoder: bool = False,
        no_beam_search_op: bool = False,
        output_qk: bool = False,
    ):
        """Optimize ONNX model with an option to convert it to use mixed precision."""

        from fusion_options import FusionOptions

        optimization_options = FusionOptions("bart")
        optimization_options.use_multi_head_attention = True
        optimization_options.disable_multi_head_attention_bias = provider == "rocm"

        m = optimize_model(
            onnx_model_path,
            model_type="bart",
            num_heads=num_attention_heads,
            hidden_size=hidden_size,
            opt_level=0,
            optimization_options=optimization_options,
            use_gpu=use_gpu,
            only_onnxruntime=False,
        )

        # Add `past_sequence_length`, `cache_indirection`, and `output_qk` to `MultiHeadAttention` ops
        if is_decoder and no_beam_search_op:
            if provider == "cuda":  # FP32 CPU can be supported here once the DMMHA CPU kernel bugs are fixed
                # FP16 CUDA, FP32 CUDA, and FP32 CPU use the `DecoderMaskedMultiHeadAttention` kernel
                # via `MultiHeadAttention`, which requires the `past_sequence_length` and
                # `cache_indirection` inputs
                m, past_seq_len_name = fix_past_sequence_length(m)
                m = add_cache_indirection_to_mha(m, past_seq_len_name)

            if output_qk:
                m = add_output_qk_to_mha(m, skip_node_idxs=list(range(0, 2 * num_layers, 2)))

        m.save_model_to_file(optimized_model_path, use_external_data_format, all_tensors_to_one_file=True)

    @staticmethod
    def pt_transcription_for_verify_onnx(
        processor: WhisperProcessor,
        pt_model: torch.nn.Module,
        device: torch.device,
        batch_size: int = 1,
        prompt_mode: bool = False,
    ):
        # Try to import `datasets` pip package
        try:
            from datasets import load_dataset
        except Exception as e:
            logger.error(f"An error occurred while importing `datasets`: {e}", exc_info=True)  # noqa: G201
            install_cmd = "pip install datasets"
            logger.warning(f"Could not import `datasets`. Attempting to install `datasets` via `{install_cmd}`.")
            os.system(install_cmd)

        from datasets import load_dataset

        ds = load_dataset("hf-internal-testing/librispeech_asr_dummy", "clean", split="validation")
        input_features_ = []
        if batch_size == 1:
            input_features = processor([ds[0]["audio"]["array"]], return_tensors="pt").input_features
        else:
            input_features_ = [
                processor([ds[3]["audio"]["array"]], return_tensors="pt").input_features,
                processor([ds[3]["audio"]["array"]], return_tensors="pt").input_features,
            ]
            assert len(input_features_) == batch_size
            input_features = torch.cat((input_features_[0], input_features_[1]))

        max_length, min_length, num_beams, num_return_sequences = 30, 0, 1, 1
        length_penalty, repetition_penalty = 1.0, 1.0
        inputs = {
            "input_features": input_features.to(device),
            "max_length": max_length,
            "min_length": min_length,
            "num_beams": num_beams,
            "num_return_sequences": num_return_sequences,
            "length_penalty": length_penalty,
            "repetition_penalty": repetition_penalty,
            "early_stopping": True,
            "use_cache": True,
        }

        if prompt_mode:
            prompts = ["John has doubts", "Maria has grave doubts"]
            prompt_ids = [processor.get_prompt_ids(p) for p in prompts]
            pt_transcription = []
            pt_outputs = []
            # The looping for model.generate is necessary here due to the limitation as per
            # https://huggingface.co/docs/transformers/model_doc/whisper#transformers.WhisperForConditionalGeneration.generate.prompt_ids
            # prompt_ids input requires a tensor of rank 1
            for i in range(batch_size):
                inputs["prompt_ids"] = torch.from_numpy(prompt_ids[i]).to(device=device)
                inputs["input_features"] = input_features_[i].to(device)
                pt_output = pt_model.generate(**inputs).detach().cpu().numpy()
                pt_outputs.append(pt_output)
                pt_transcription.append(processor.batch_decode(pt_output, skip_special_tokens=True)[0])
            inputs["input_features"] = input_features
            del inputs["prompt_ids"]
        else:
            prompt_ids = []
            pt_outputs = pt_model.generate(**inputs).detach().cpu().numpy()
            pt_transcription = [processor.batch_decode(pt_outputs, skip_special_tokens=True)[0]]
            pt_outputs = list(pt_outputs)
        del inputs["early_stopping"]
        del inputs["use_cache"]
        return inputs, pt_transcription, pt_outputs, prompt_ids

    @staticmethod
    def select_transcription_options(
        batch_size: int,
        prompt_mode: bool,
    ):
        if batch_size > 1 and prompt_mode:
            expected_transcription_no_comma_prompt1 = " John has doubts whether Sir Frederick Layton's work is really Greek after all and can discover in it but little of Rocky I"
            expected_transcription_misspelled_prompt1 = " John has doubts whether Sir Frederick Latins work is really Greek after all and can discover in it but little of Rocky I"
            expected_transcription_no_comma_prompt2 = " Maria has grave doubts whether Sir Frederick Layton's work is really Greek after all and can discover in it but little of Rocky"
            expected_transcription_misspelled_prompt2 = " Maria has grave doubts whether Sir Frederick Latins work is really Greek after all and can discover in it but little of Rocky I"
            expected_transcription_options = {
                expected_transcription_no_comma_prompt1,
                expected_transcription_no_comma_prompt2,
                expected_transcription_misspelled_prompt1,
                expected_transcription_misspelled_prompt2,
            }
        else:
            expected_transcription_no_comma = (
                " Mr. Quilter is the apostle of the middle classes and we are glad to welcome his gospel."
            )
            expected_transcription_with_comma = (
                " Mr. Quilter is the apostle of the middle classes, and we are glad to welcome his gospel."
            )
            expected_transcription_with_quote_and_comma = (
                ' "Mr. Quilter is the apostle of the middle classes, and we are glad to welcome his gospel.'
            )
            expected_transcription_options = {
                expected_transcription_no_comma,
                expected_transcription_with_comma,
                expected_transcription_with_quote_and_comma,
            }
        return expected_transcription_options

    @staticmethod
    def get_outputs(
        pt_outputs: np.ndarray,
        ort_outputs: np.ndarray,
        i: int,
    ):
        """Get PyTorch and ONNX Runtime output token ids at index i"""
        pt_output, ort_output = pt_outputs[i], ort_outputs[i]
        pt_shape, ort_shape = pt_output.shape, ort_output.shape

        # Hugging Face impl. + Beam Search op: PyTorch = (26,) and ORT = (30,)
        # OpenAI impl. + Beam Search op: PyTorch = (1, 30) and ORT = (30,)
        if pt_shape != ort_shape:
            if len(pt_shape) > 1:
                pt_output = pt_output[0]
                pt_shape = pt_output.shape
            if len(ort_shape) > 1:
                ort_output = ort_output[0]
                ort_shape = ort_output.shape
            if pt_shape[0] != ort_shape[0]:
                min_len = min(pt_shape[0], ort_shape[0])
                pt_output = pt_output[:min_len]
                ort_output = ort_output[:min_len]

        assert pt_output.shape == ort_output.shape
        return pt_output, ort_output

    @staticmethod
    def verify_onnx(
        model_name_or_path: str,
        cache_dir: str,
        ort_session: InferenceSession,
        device: torch.device,
        batch_size: int = 1,
        prompt_mode: bool = False,
    ):
        """Compare the result from PyTorch and ONNX Runtime to verify the ONNX model is good."""
        pt_model = WhisperForConditionalGeneration.from_pretrained(
            model_name_or_path, cache_dir=cache_dir, attn_implementation="eager"
        ).to(device)
        processor = WhisperProcessor.from_pretrained(model_name_or_path, cache_dir=cache_dir)
        config = WhisperConfig.from_pretrained(model_name_or_path, cache_dir=cache_dir)

        inputs, pt_transcription, pt_outputs, decoder_prompt_ids = WhisperHelper.pt_transcription_for_verify_onnx(
            processor,
            pt_model,
            device,
            batch_size=batch_size,
            prompt_mode=prompt_mode,
        )

        start_id = [config.decoder_start_token_id]  # ex: [50258]
        prompt_ids = processor.get_decoder_prompt_ids(language="english", task="transcribe")
        prompt_ids = [token[1] for token in prompt_ids]  # ex: [50259, 50358, 50363]
        forced_decoder_ids = start_id + prompt_ids  # ex: [50258, 50259, 50358, 50363]

        ort_names = [entry.name for entry in ort_session.get_inputs()]
        ort_dtypes = [entry.type for entry in ort_session.get_inputs()]
        ort_to_np = {
            "tensor(float)": np.float32,
            "tensor(float16)": np.float16,
            "tensor(int64)": np.int64,
            "tensor(int32)": np.int32,
            "tensor(int8)": np.int8,
            "tensor(uint8)": np.uint8,
        }

        use_extra_decoding_ids = "extra_decoding_ids" in ort_names
        for name, dtype in zip(ort_names, ort_dtypes, strict=False):
            if name == "input_features":
                inputs[name] = inputs[name].detach().cpu().numpy()
            elif name == "vocab_mask":
                inputs[name] = np.ones(config.vocab_size, dtype=ort_to_np[dtype])
            elif name == "prefix_vocab_mask":
                inputs[name] = np.ones((batch_size, config.vocab_size), dtype=ort_to_np[dtype])
            elif name == "decoder_input_ids":
                if not prompt_mode:
                    raw_input_ids = [start_id] if use_extra_decoding_ids else [forced_decoder_ids]
                    inputs[name] = np.array(raw_input_ids, dtype=ort_to_np[dtype])
                else:
                    # This logic handles the scenario for when prompts are not of the same size
                    # For example if our prompt ids are [p1_id_1, p1_id_2] and [p2_id_1]
                    # The final decoder_input_ids will look as such after padding
                    # [prev_token, p1_id_1, p1_id_2, start_token, lang_token, transcribe_token]
                    # [prev_token, p2_id_1, PAD_TOKEN, start_token, lang_token, transcribe_token]
                    ort_prompts = []
                    for i in range(batch_size):
                        ort_prompts.append(decoder_prompt_ids[i].tolist())
                    max_len = max(len(p) for p in ort_prompts)
                    padded_prompts = []
                    for p in ort_prompts:
                        padded_prompt = [*p, *([config.pad_token_id] * (max_len - len(p)))]
                        padded_prompts.append(padded_prompt + forced_decoder_ids)
                    inputs[name] = np.array(padded_prompts, dtype=ort_to_np[dtype])
            elif name == "logits_processor":
                inputs[name] = np.array([1], dtype=ort_to_np[dtype])
            elif name == "cross_qk_layer_head":
                inputs[name] = np.array([[0, 0]], dtype=ort_to_np[dtype])
            elif name == "extra_decoding_ids":
                inputs[name] = np.repeat(np.array([prompt_ids], dtype=ort_to_np[dtype]), batch_size, 0)
            elif name == "temperature":
                inputs[name] = np.array([1.0], dtype=ort_to_np[dtype])
            else:
                inputs[name] = np.array([inputs[name]], dtype=ort_to_np[dtype])

        ort_outputs = ort_session.run(None, inputs)[0][:, 0, :]
        ort_transcription = processor.batch_decode(ort_outputs, skip_special_tokens=True)
        expected_transcription_options = WhisperHelper.select_transcription_options(batch_size, prompt_mode)

        parity = 1
        for i in range(batch_size):
            pt_output, ort_output = WhisperHelper.get_outputs(pt_outputs, ort_outputs, i)

            # Check if token ids match
            parity *= np.allclose(pt_output, ort_output)

            # Check if transcribed outputs match
            parity *= (
                pt_transcription[i] in expected_transcription_options
                and ort_transcription[i] in expected_transcription_options
            )
        max_diff = 0

        if not parity:
            for i in range(batch_size):
                pt_output, ort_output = WhisperHelper.get_outputs(pt_outputs, ort_outputs, i)
                diff = pt_output - ort_output

                max_diff_i = max(diff.min(), diff.max(), key=abs)
                max_diff = max(max_diff, max_diff_i)

        if max_diff != 0:
            logger.warning(f"PyTorch outputs: {pt_transcription}")
            logger.warning(f"ONNX Runtime outputs: {ort_transcription}")

        return 0
