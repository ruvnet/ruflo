# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation.  All rights reserved.
# Licensed under the MIT License.
# --------------------------------------------------------------------------
import logging

import numpy as np
from fusion_attention import AttentionMask, FusionAttention
from onnx import TensorProto, helper
from onnx_model import OnnxModel

logger = logging.getLogger(__name__)


class FusionBartAttention(FusionAttention):
    """
    Fuse Bart Attention subgraph into one Attention node.
    """

    def __init__(
        self,
        model: OnnxModel,
        hidden_size: int,
        num_heads: int,
        attention_mask: AttentionMask,
    ):
        super().__init__(model, hidden_size, num_heads, attention_mask)

    def check_runtime_shape_path(
        self,
        reshape_qkv_2,
        reshape_qkv_1,
        reshape_q_2,
        reshape_k_2,
        reshape_v_2,
        root_input,
    ):
        concat_qkv_2_path = self.model.match_parent_path(reshape_qkv_2, ["Concat"], [1])
        if concat_qkv_2_path is None:
            return False
        concat_qkv_2 = concat_qkv_2_path[0]

        reshape_qkv_2_path_1 = self.model.match_parent_path(concat_qkv_2, ["Unsqueeze", "Gather", "Shape"], [0, 0, 0])
        reshape_qkv_2_path_2 = self.model.match_parent_path(concat_qkv_2, ["Unsqueeze", "Gather", "Shape"], [1, 0, 0])
        if reshape_qkv_2_path_1 is None or reshape_qkv_2_path_2 is None:
            return False

        _, gather_1, shape_1 = reshape_qkv_2_path_1
        _, gather_2, shape_2 = reshape_qkv_2_path_2

        if shape_1.input[0] != root_input or shape_2.input[0] != root_input:
            return False

        reshape_qkv_1_path_1 = self.model.match_parent_path(reshape_qkv_1, ["Concat", "Unsqueeze", "Gather"], [1, 0, 0])
        reshape_qkv_1_path_2 = self.model.match_parent_path(reshape_qkv_1, ["Concat", "Unsqueeze", "Gather"], [1, 2, 0])
        if reshape_qkv_1_path_1 is None or reshape_qkv_1_path_2 is None:
            return False
        if reshape_qkv_1_path_1[-1].name != gather_1.name or reshape_qkv_1_path_2[-1].name != gather_2.name:
            return False

        reshape_q_2_path = self.model.match_parent_path(reshape_q_2, ["Concat", "Unsqueeze", "Mul"], [1, 0, 0])
        reshape_k_2_path = self.model.match_parent_path(reshape_k_2, ["Concat", "Unsqueeze", "Mul"], [1, 0, 0])
        reshape_v_2_path = self.model.match_parent_path(reshape_v_2, ["Concat", "Unsqueeze", "Mul"], [1, 0, 0])
        if reshape_q_2_path is None or reshape_k_2_path is None or reshape_v_2_path is None:
            return False

        mul_q = reshape_q_2_path[-1]
        mul_k = reshape_k_2_path[-1]
        mul_v = reshape_v_2_path[-1]

        gather_1_out = gather_1.output[0]
        if mul_q.input[0] != gather_1_out or mul_k.input[0] != gather_1_out or mul_v.input[0] != gather_1_out:
            return False

        return True

    def check_runtime_shape_path_openai(
        self,
        reshape_qkv_2,
        matmul_qkv,
        add_qk,
        matmul_qk,
        add_q,
    ):
        reshape_qkv_path = self.model.match_parent_path(
            reshape_qkv_2, ["Concat", "Slice", "Shape", "Transpose"], [1, 0, 0, 0]
        )
        if reshape_qkv_path is None or reshape_qkv_path[-1].input[0] != matmul_qkv.output[0]:
            return False

        matmul_qk_path_1 = self.model.match_parent_path(
            matmul_qk, ["Mul", "Pow", "Cast", "Div", "Gather", "Shape"], [0, 1, 0, 0, 0, 0]
        )
        matmul_qk_path_2 = self.model.match_parent_path(
            matmul_qk, ["Mul", "Pow", "Cast", "Div", "Gather", "Shape"], [1, 1, 0, 0, 0, 0]
        )
        if matmul_qk_path_1 is None or matmul_qk_path_2 is None:
            return False

        mul_1 = matmul_qk_path_1[0]
        mul_2 = matmul_qk_path_2[0]
        if mul_1.input[1] != mul_2.input[1]:
            return False
        if matmul_qk_path_1[-1].input[0] != add_q.output[0] and matmul_qk_path_2[-1].input[0] != add_q.output[0]:
            return False

        # For decoder attentions only
        if add_qk is not None:
            add_qk_path = self.model.match_parent_path(add_qk, ["Slice"], [1])
            if add_qk_path is None:
                return False
            slice_q_path_1 = self.model.match_parent_path(
                add_qk_path[0], ["Slice", "Unsqueeze", "Gather", "Shape"], [0, 2, 0, 0]
            )
            slice_q_path_2 = self.model.match_parent_path(add_qk_path[0], ["Unsqueeze", "Gather", "Shape"], [2, 0, 0])
            if slice_q_path_1 is None and slice_q_path_2 is None:
                return False
            _, unsqueeze_1, _, _ = slice_q_path_1
            unsqueeze_2, _, _ = slice_q_path_2
            if unsqueeze_1.input[0] != unsqueeze_2.input[0]:
                return False
            if slice_q_path_1[-1].input[0] != add_q.output[0] and slice_q_path_2[-1].input[0] != add_q.output[0]:
                return False

        return True

    def fuse(self, normalize_node, input_name_to_nodes, output_name_to_node):
        # Track if fusion is occurring for OpenAI implementation of Whisper
        model_impl_openai = False

        # SkipLayerNormalization has two inputs, and one of them is the root input for attention.
        qkv_nodes = self.model.match_parent_path(
            normalize_node,
            ["Add", "MatMul", "Reshape", "Transpose", "Reshape", "MatMul"],
            [1, 1, 0, 0, 0, 0],
        )
        qkv_nodes_openai = self.model.match_parent_path(
            normalize_node,
            ["Add", "MatMul", "Reshape", "Transpose", "MatMul"],
            [1, 1, 0, 0, 0],
        )
        if qkv_nodes is not None:
            (
                add_out,
                matmul_out,
                reshape_qkv_2,
                transpose_qkv,
                reshape_qkv_1,
                matmul_qkv,
            ) = qkv_nodes
        elif qkv_nodes_openai is not None:
            qkv_nodes = qkv_nodes_openai
            (
                add_out,
                matmul_out,
                reshape_qkv_2,
                transpose_qkv,
                matmul_qkv,
            ) = qkv_nodes
            # Set model implementation to openai
            model_impl_openai = True
        else:
            return

        other_inputs = []
        for input in normalize_node.input:
            if input not in output_name_to_node:
                continue
            if input == qkv_nodes[0].output[0]:
                continue
            other_inputs.append(input)
        if len(other_inputs) != 1:
            return
        root_input = other_inputs[0]

        # Sometimes the input name to the attention MatMul nodes does not match the input name to the end
        # SkipLayerNormalization node (name saved in root_input). We find the true input name to the MatMul
        # nodes by getting the initial SkipLayerNormalization node and checking how many MatMul nodes are
        # children nodes for each of its output names.
        """
                                        root_input
                    +---------------------------------------------------+
                    |                                                   |
                    |                                                   |
        SkipLayerNormalization --> Attention --> MatMul --> SkipLayerNormalization
        """
        skip_layernorm = output_name_to_node[root_input]
        # For some attention blocks, the end SkipLayerNormalization node may point to an Add node whose
        # child is the LayerNormalization node.
        if skip_layernorm.op_type == "Add":
            skip_layernorm = self.model.get_children(skip_layernorm)[0]
        for output in skip_layernorm.output:
            if not output:
                continue
            children = input_name_to_nodes[output]
            children_types = [child.op_type for child in children]
            if children_types.count("MatMul") >= 1:
                root_input = output
                break

        graph_input_names = {node.name for node in self.model.graph().input}
        graph_output_names = {node.name for node in self.model.graph().output}

        v_nodes = self.model.match_parent_path(
            matmul_qkv,
            ["Reshape", "Transpose", "Reshape", "Add", "MatMul"],
            [1, 0, 0, 0, None],
        )
        v_nodes_openai = self.model.match_parent_path(
            matmul_qkv,
            ["Transpose", "Reshape", "Add", "MatMul"],
            [1, 0, 0, None],
        )
        v_nodes_with_past_self_attn = self.model.match_parent_path(
            # Decoder attention with past value concatenated before MatMul
            matmul_qkv,
            ["Reshape", "Concat", "Transpose", "Reshape", "Add", "MatMul"],
            [1, 0, 1, 0, 0, None],
        )
        v_nodes_with_past_cross_attn = self.model.match_parent_path(
            # Decoder attention with past value directly used in MatMul
            matmul_qkv,
            ["Reshape"],
            [1],
        )
        v_nodes_with_past_cross_attn_openai = self.model.match_parent_path(
            matmul_qkv,
            ["Transpose", "Reshape", "Reshape", "Transpose"],
            [1, 0, 0, 0],
        )
        past_v, present_v = "", ""
        reshape_v_2, add_v = None, None
        if v_nodes is not None:
            (reshape_v_2, transpose_v, reshape_v_1, add_v, matmul_v) = v_nodes
            # For initial pass through encoder-decoder_with_past to get starting past values (beam search)
            present_v = transpose_v.output[0]
        elif v_nodes_openai is not None:
            v_nodes = v_nodes_openai
            (transpose_v, reshape_v_1, add_v, matmul_v) = v_nodes
            # For initial pass through encoder-decoder_with_past to get starting past values (beam search)

            # Find the child path to access the correct present_v values
            # Openai impl provides present/past v values in 3D format
            # whereas ort MultiHeadAttention expects v values in 4D, hence the
            # additional Reshape and Transpose nodes are added
            # For encoder attention types
            # Add -> Reshape -> Transpose -> Present_V
            reshape_path = self.model.match_child_path(
                add_v,
                ["Reshape", "Transpose"],
                exclude=[reshape_v_1],
            )
            # For decoder attention types
            # add_v_node                     Reshape <- Transpose <-Past_V
            #           \                  /
            #             \              /
            #               -> Concat <-
            #                    |
            #                    |--> Reshape -> Transpose -> Present_V
            concat_path = self.model.match_child_path(add_v, ["Concat", "Reshape", "Transpose"])
            if reshape_path is not None:
                (_, transpose_add_v) = reshape_path
                if transpose_add_v.output[0] in graph_output_names:
                    present_v = transpose_add_v.output[0]
            if concat_path is not None:
                (concat_v, _, transpose_concat_v) = concat_path
                if transpose_concat_v.output[0] in graph_output_names:
                    present_v = transpose_concat_v.output[0]
                concat_nodes = self.model.match_parent_path(concat_v, ["Reshape", "Transpose"], [0, 0])
                _, transpose_concat_v_in = concat_nodes
                past_v = transpose_concat_v_in.input[0]
        elif v_nodes_with_past_self_attn is not None:
            (reshape_v_2, concat_v, transpose_v, reshape_v_1, add_v, matmul_v) = v_nodes_with_past_self_attn
            v_nodes = v_nodes_with_past_self_attn
            past_v = concat_v.input[0]
            present_v = concat_v.output[0]
        elif (
            v_nodes_with_past_cross_attn is not None and v_nodes_with_past_cross_attn[-1].input[0] in graph_input_names
        ):
            v_nodes = v_nodes_with_past_cross_attn
            past_v = v_nodes[-1].input[0]
            present_v = v_nodes[-1].output[0]
            if present_v not in graph_output_names:
                identity_node_v = list(
                    filter(lambda node: node.op_type == "Identity", self.model.input_name_to_nodes()[past_v])
                )
                present_v = identity_node_v[0].output[0] if len(identity_node_v) == 1 else ""
        elif (
            v_nodes_with_past_cross_attn_openai is not None
            and v_nodes_with_past_cross_attn_openai[-1].input[0] in graph_input_names
        ):
            v_nodes = v_nodes_with_past_cross_attn_openai
            past_v = v_nodes[-1].input[0]
            present_v = v_nodes[-1].output[0]
            if present_v not in graph_output_names:
                identity_node_v = list(
                    filter(lambda node: node.op_type == "Identity", self.model.input_name_to_nodes()[past_v])
                )
                present_v = identity_node_v[0].output[0] if len(identity_node_v) == 1 else ""
        else:
            logger.debug("fuse_attention: failed to match v path")
            return
        past_v = past_v if past_v in graph_input_names else ""
        present_v = present_v if present_v in graph_output_names else ""

        qk_nodes_1 = self.model.match_parent_path(matmul_qkv, ["Softmax", "MatMul"], [0, 0])
        qk_nodes_2 = self.model.match_parent_path(
            matmul_qkv, ["Softmax", "Reshape", "Add", "Reshape", "MatMul"], [0, 0, 0, 0, 0]
        )
        qk_nodes_2_openai = self.model.match_parent_path(matmul_qkv, ["Softmax", "Add", "MatMul"], [0, 0, 0])
        add_qk = None
        if qk_nodes_1 is not None:
            _, matmul_qk = qk_nodes_1
            qk_nodes = qk_nodes_1
        elif qk_nodes_2 is not None:
            _, _, add_qk, _, matmul_qk = qk_nodes_2
            qk_nodes = qk_nodes_2
        elif qk_nodes_2_openai is not None:
            _, add_qk, matmul_qk = qk_nodes_2_openai
            qk_nodes = qk_nodes_2_openai
        else:
            return

        q_nodes = self.model.match_parent_path(
            matmul_qk,
            ["Reshape", "Transpose", "Reshape", "Mul", "Add", "MatMul"],
            [0, 0, 0, 0, 0, 1],
        )
        q_nodes_openai = self.model.match_parent_path(
            matmul_qk,
            ["Mul", "Transpose", "Reshape", "Add", "MatMul"],
            [0, 0, 0, 0, 1],
        )
        reshape_q_2 = None
        if q_nodes is not None:
            reshape_q_2, transpose_q, reshape_q_1, mul_q, add_q, matmul_q = q_nodes
        elif q_nodes_openai is not None:
            q_nodes = q_nodes_openai
            mul_q, transpose_q, reshape_q_1, add_q, matmul_q = q_nodes
        else:
            return

        k_nodes_with_bias = self.model.match_parent_path(
            matmul_qk,
            ["Transpose", "Reshape", "Transpose", "Reshape", "Add", "MatMul"],
            [1, 0, 0, 0, 0, 1],
        )
        k_nodes_no_bias_openai = self.model.match_parent_path(
            matmul_qk,
            ["Mul", "Transpose", "Reshape", "MatMul"],
            [1, 0, 0, 0],
        )
        k_nodes_no_bias = self.model.match_parent_path(
            matmul_qk,
            ["Transpose", "Reshape", "Transpose", "Reshape", "MatMul"],
            [1, 0, 0, 0, 0],
        )
        k_nodes_no_bias_with_past_self_attn = self.model.match_parent_path(
            # Decoder attention with past key concatenated before MatMul
            matmul_qk,
            ["Transpose", "Reshape", "Concat", "Transpose", "Reshape", "MatMul"],
            [1, 0, 0, 1, 0, 0],
        )
        k_nodes_no_bias_with_past_cross_attn = self.model.match_parent_path(
            # Decoder attention with past key directly used in MatMul
            matmul_qk,
            ["Transpose", "Reshape"],
            [1, 0],
        )
        k_nodes_no_bias_with_past_cross_attn_openai = self.model.match_parent_path(
            # Decoder attention with past key directly used in MatMul
            matmul_qk,
            ["Mul", "Transpose", "Reshape", "Reshape", "Transpose"],
            [1, 0, 0, 0, 0],
        )
        past_k, present_k = "", ""
        reshape_k_2, reshape_k_1, matmul_k = None, None, None
        if k_nodes_with_bias is not None:
            _, reshape_k_2, transpose_k_1, reshape_k_1, add_k, matmul_k = k_nodes_with_bias
            k_nodes = k_nodes_with_bias
        elif k_nodes_no_bias_openai is not None:
            mul_k, transpose_k_1, reshape_k_1, matmul_k = k_nodes_no_bias_openai
            k_nodes = k_nodes_no_bias_openai
            present_k = matmul_k.output[0]

            # Find the child path to access the correct present_k values
            # Openai impl provides present/past k values in 3D format
            # whereas ort MultiHeadAttention expects k values in 4D, hence the
            # additional Reshape and Transpose nodes are added
            # For encoder attention types
            # Matmul -> Reshape -> Transpose -> Present_K
            reshape_path = self.model.match_child_path(
                matmul_k,
                ["Reshape", "Transpose"],
                exclude=[reshape_k_1],
            )
            # For decoder attention types
            # matmul_k_node                  Reshape <- Transpose <- Past_K
            #           \                  /
            #             \              /
            #               -> Concat <-
            #                    |
            #                    +--> Reshape -> Transpose -> Present_K
            concat_path = self.model.match_child_path(matmul_k, ["Concat", "Reshape", "Transpose"])
            if reshape_path is not None:
                (_, transpose_matmul_k) = reshape_path
                if transpose_matmul_k.output[0] in graph_output_names:
                    present_k = transpose_matmul_k.output[0]
            if concat_path is not None:
                (concat_k, _, transpose_concat_k) = concat_path
                if transpose_concat_k.output[0] in graph_output_names:
                    present_k = transpose_concat_k.output[0]
                concat_nodes = self.model.match_parent_path(concat_k, ["Reshape", "Transpose"], [0, 0])
                _, transpose_concat_k_in = concat_nodes
                past_k = transpose_concat_k_in.input[0]
        elif k_nodes_no_bias is not None:
            _, reshape_k_2, transpose_k_1, reshape_k_1, matmul_k = k_nodes_no_bias
            k_nodes = k_nodes_no_bias
            # For initial pass through encoder-decoder_with_past to get starting past values (beam search)
            present_k = transpose_k_1.output[0]
        elif k_nodes_no_bias_with_past_self_attn is not None:
            _, reshape_k_2, concat_k, _, reshape_k_1, matmul_k = k_nodes_no_bias_with_past_self_attn
            k_nodes = k_nodes_no_bias_with_past_self_attn
            past_k = concat_k.input[0]
            present_k = concat_k.output[0]
        elif (
            k_nodes_no_bias_with_past_cross_attn is not None
            and k_nodes_no_bias_with_past_cross_attn[-1].input[0] in graph_input_names
        ):
            k_nodes = k_nodes_no_bias_with_past_cross_attn
            past_k = k_nodes[-1].input[0]
            present_k = k_nodes[-1].output[0]
            if present_k not in graph_output_names:
                identity_node_k = list(
                    filter(lambda node: node.op_type == "Identity", self.model.input_name_to_nodes()[past_k])
                )
                present_k = identity_node_k[0].output[0] if len(identity_node_k) == 1 else ""
        elif (
            k_nodes_no_bias_with_past_cross_attn_openai is not None
            and k_nodes_no_bias_with_past_cross_attn_openai[-1].input[0] in graph_input_names
        ):
            k_nodes = k_nodes_no_bias_with_past_cross_attn_openai
            past_k = k_nodes[-1].input[0]
            present_k = k_nodes[-1].output[0]
            if present_k not in graph_output_names:
                identity_node_k = list(
                    filter(lambda node: node.op_type == "Identity", self.model.input_name_to_nodes()[past_k])
                )
                present_k = identity_node_k[0].output[0] if len(identity_node_k) == 1 else ""
        else:
            return
        past_k = past_k if past_k in graph_input_names else ""
        present_k = present_k if present_k in graph_output_names else ""

        if k_nodes in (k_nodes_no_bias_openai, k_nodes_no_bias, k_nodes_no_bias_with_past_self_attn):
            # Create empty Add node for attention graph
            bias_dim = self.model.get_initializer(add_v.input[0]).dims[0]
            empty_bias_name = "empty_bias"
            empty_tensor = self.model.get_initializer(empty_bias_name)
            if empty_tensor is None:
                self.add_initializer(
                    empty_bias_name,
                    TensorProto.FLOAT,
                    dims=[bias_dim],
                    vals=np.array([0.0] * bias_dim, dtype=np.float32),
                )

            add_name = self.model.create_node_name("Add")
            add_k = helper.make_node("Add", [empty_bias_name, matmul_k.output[0]], [reshape_k_1.name], add_name)

        if (
            model_impl_openai
            and not bool(past_k)
            and not self.check_runtime_shape_path_openai(
                reshape_qkv_2,
                matmul_qkv,
                add_qk,
                matmul_qk,
                add_q,
            )
        ):
            return
        elif (
            not model_impl_openai
            and not bool(past_k)
            and not self.check_runtime_shape_path(
                reshape_qkv_2,
                reshape_qkv_1,
                reshape_q_2,
                reshape_k_2,
                reshape_v_2,
                root_input,
            )
        ):
            return

        three_root_inputs = bool(past_k) and bool(past_v) and matmul_k is None and "matmul_v" not in locals()
        one_root_input = (
            not three_root_inputs
            and matmul_k.input[0] == root_input
            and matmul_q.input[0] == root_input
            and matmul_v.input[0] == root_input
        )
        two_root_inputs = (
            not three_root_inputs
            and matmul_q.input[0] == root_input
            and matmul_k.input[0] == matmul_v.input[0]
            and matmul_k.input[0] != matmul_q.input[0]
        )

        # There are 5 types of attention:
        # 1) Encoder attention with one_root_input=True and qk_nodes=qk_nodes_1
        # 2) Decoder attention with one_root_input=True and qk_nodes=qk_nodes_2
        # 3) Decoder attention with past with one_root_input=True and qk_nodes=qk_nodes_1 and past_k=past_decoder_key and past_v=past_decoder_value
        # 4) Decoder cross attention with two_root_inputs=True and qk_nodes=qk_nodes_1
        # 5) Decoder cross attention with past with three_root_inputs=True and qk_nodes=qk_nodes_1
        encoder_attention = one_root_input and qk_nodes == qk_nodes_1
        decoder_attention = one_root_input and qk_nodes in (qk_nodes_2, qk_nodes_2_openai)
        decoder_attention_with_past = (
            (encoder_attention if not model_impl_openai else decoder_attention) and bool(past_k) and bool(past_v)
        )
        decoder_cross_attention = two_root_inputs and qk_nodes == qk_nodes_1
        decoder_cross_attention_with_past = three_root_inputs and qk_nodes == qk_nodes_1

        # For decoder_attention, the attention mask needs to be included in the attention node
        mask_index, mask_nodes = None, []
        if decoder_attention:
            mask_nodes_bart = self.model.match_parent_path(
                add_qk,
                ["Where"],
                [1],
            )
            mask_nodes_whisper = self.model.match_parent_path(
                add_qk,
                ["Expand", "Unsqueeze", "Unsqueeze", "Where"],
                [1, 0, 0, 0],
            )
            if mask_nodes_whisper is not None:
                mask_index = mask_nodes_whisper[0].output[-1]
                mask_nodes = mask_nodes_whisper
            elif mask_nodes_bart is not None:
                mask_index = mask_nodes_bart[0].output[-1]
                mask_nodes = mask_nodes_bart

        if (
            encoder_attention
            or decoder_attention
            or decoder_attention_with_past
            or decoder_cross_attention
            or decoder_cross_attention_with_past
        ):
            attention_last_node = reshape_qkv_2
            num_heads, hidden_size = self.get_num_heads_and_hidden_size(reshape_q_1)

            if num_heads <= 0 or hidden_size <= 0 or (hidden_size % num_heads) != 0:
                logger.debug("fuse_attention: failed to detect num_heads or hidden_size")
                return

            new_node = None
            if decoder_attention_with_past or decoder_cross_attention or decoder_cross_attention_with_past:
                # Note: Decoder attention with past key and past value is fused as multihead attention
                # rather than attention because multihead attention supports separate past key and past
                # value whereas attention supports concatenated past key and past value.
                new_node = (
                    self.create_multihead_attention_node(
                        q_matmul=matmul_q,
                        k_matmul=matmul_k if decoder_cross_attention or decoder_attention_with_past else past_k,
                        v_matmul=matmul_v if decoder_cross_attention or decoder_attention_with_past else past_v,
                        q_add=add_q,
                        k_add=add_k if decoder_cross_attention or decoder_attention_with_past else None,
                        v_add=add_v if decoder_cross_attention or decoder_attention_with_past else None,
                        num_heads=num_heads,
                        hidden_size=hidden_size,
                        output=attention_last_node.output[0],
                        unidirectional=decoder_attention_with_past,
                        past_k=past_k if decoder_attention_with_past else "",
                        past_v=past_v if decoder_attention_with_past else "",
                        present_k=present_k,
                        present_v=present_v,
                        packed_qkv=decoder_attention_with_past,
                    )
                    if self.use_multi_head_attention
                    else None
                )
            else:
                # Temporarily set multihead attention flag to false
                use_multi_head_attention_ground_truth = self.use_multi_head_attention
                self.use_multi_head_attention = False
                add_qk_str = mask_index if decoder_attention and mask_index else ""
                new_node = self.create_attention_node(
                    mask_index=None,
                    q_matmul=matmul_q,
                    k_matmul=matmul_k,
                    v_matmul=matmul_v,
                    q_add=add_q,
                    k_add=add_k,
                    v_add=add_v,
                    num_heads=num_heads,
                    hidden_size=hidden_size,
                    first_input=root_input,
                    output=attention_last_node.output[0],
                    add_qk_str=(
                        None if len(mask_nodes) > 1 else add_qk_str
                    ),  # deprecate and use is_unidirectional attr instead for Whisper
                    past_k=past_k,
                    past_v=past_v,
                    present_k=present_k,
                    present_v=present_v,
                    causal=decoder_attention,
                )
                self.use_multi_head_attention = use_multi_head_attention_ground_truth
            if new_node is None:
                return

            self.nodes_to_add.append(new_node)
            self.node_name_to_graph_name[new_node.name] = self.this_graph_name

            self.nodes_to_remove.extend([attention_last_node, transpose_qkv, matmul_qkv])
            self.nodes_to_remove.extend(qk_nodes)

            # When using multihead attention, keep MatMul nodes in original graph
            if decoder_attention_with_past or decoder_cross_attention or decoder_cross_attention_with_past:
                if q_nodes[-1].op_type == "MatMul":
                    q_nodes.pop()
                if k_nodes[-1].op_type == "MatMul":
                    k_nodes.pop()
                if v_nodes[-1].op_type == "MatMul":
                    v_nodes.pop()
                if self.disable_multi_head_attention_bias and (
                    decoder_cross_attention or decoder_cross_attention_with_past
                ):
                    if q_nodes[-1].op_type == "Add":
                        q_nodes.pop()
                    if k_nodes[-1].op_type == "Add":
                        k_nodes.pop()
                    if v_nodes[-1].op_type == "Add":
                        v_nodes.pop()

            self.nodes_to_remove.extend(q_nodes)
            self.nodes_to_remove.extend(k_nodes)
            self.nodes_to_remove.extend(v_nodes)

            # Use prune graph to remove mask nodes since they are shared by all attention nodes.
            self.prune_graph = True
