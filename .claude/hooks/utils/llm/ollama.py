#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "openai",
#     "python-dotenv",
#     "openai",
# ]
# ///

import os
import sys
import traceback
from dotenv import load_dotenv


def prompt_llm(prompt_text):
    """
    Base Ollama LLM prompting method using GPT-OSS model.

    Args:
        prompt_text (str): The prompt to send to the model

    Returns:
        str: The model's response text, or None if error
    """
    load_dotenv()

    try:
        from openai import OpenAI

        # Ollama uses OpenAI-compatible API - exactly as shown in docs
        client = OpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama",  # required, but unused
        )

        # Default to 20b model, can override with OLLAMA_MODEL env var
        model = os.getenv("OLLAMA_MODEL", "gpt-oss:20b")

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt_text}],
            max_tokens=1000,
        )

        return response.choices[0].message.content.strip()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return None


def generate_completion_message():
    """
    Generate a completion message using Ollama LLM.

    Returns:
        str: A natural language completion message, or None if error
    """
    engineer_name = os.getenv("ENGINEER_NAME", "").strip()

    if engineer_name:
        name_instruction = f"Sometimes (about 30% of the time) include the engineer's name '{engineer_name}' in a natural way."
        examples = f"""Examples of the style: 
- Standard: "Work complete!", "All done!", "Task finished!", "Ready for your next move!"
- Personalized: "{engineer_name}, all set!", "Ready for you, {engineer_name}!", "Complete, {engineer_name}!", "{engineer_name}, we're done!" """
    else:
        name_instruction = ""
        examples = """Examples of the style: "Work complete!", "All done!", "Task finished!", "Ready for your next move!" """

    prompt = f"""Generate a short, friendly completion message for when an AI coding assistant finishes a task. 

Requirements:
- Keep it under 10 words
- Make it positive and future focused
- Use natural, conversational language
- Focus on completion/readiness
- Do NOT include quotes, formatting, or explanations
- Return ONLY the completion message text
{name_instruction}

{examples}

Generate ONE completion message:"""

    response = prompt_llm(prompt)

    # Clean up response - remove quotes and extra formatting
    if response:
        response = response.strip().strip('"').strip("'").strip()
        # Take first line if multiple lines
        response = response.split("\n")[0].strip()

    return response


def generate_agent_name():
    """
    Generate a one-word agent name using Ollama.

    Returns:
        str: A single-word agent name, or fallback name if error
    """
    import random

    # Example names to guide generation
    example_names = [
        "Phoenix",
        "Sage",
        "Nova",
        "Echo",
        "Atlas",
        "Cipher",
        "Nexus",
        "Oracle",
        "Quantum",
        "Zenith",
        "Aurora",
        "Vortex",
        "Nebula",
        "Catalyst",
        "Prism",
        "Axiom",
        "Helix",
        "Flux",
        "Synth",
        "Vertex",
    ]

    # Create examples string
    examples_str = ", ".join(example_names[:10])  # Use first 10 as examples

    prompt_text = f"""Generate exactly ONE unique agent/assistant name.

Requirements:
- Single word only (no spaces, hyphens, or punctuation)
- Abstract and memorable
- Professional sounding
- Easy to pronounce
- Similar style to these examples: {examples_str}

Generate a NEW name (not from the examples). Respond with ONLY the name, nothing else.

Name:"""

    try:
        response = prompt_llm(prompt_text)

        if response:
            # Extract and clean the name
            name = response.strip()
            # Ensure it's a single word
            name = name.split()[0] if name else "Agent"
            # Remove any punctuation
            name = "".join(c for c in name if c.isalnum())
            # Capitalize first letter
            name = name.capitalize() if name else "Agent"

            # Validate it's not empty and reasonable length
            if name and 3 <= len(name) <= 20:
                return name
            else:
                raise Exception("Invalid name generated")
        else:
            raise Exception("No response from Ollama")

    except Exception:
        # Return random fallback name
        return random.choice(example_names)


def main():
    """Command line interface for testing."""
    import json

    if len(sys.argv) > 1:
        if sys.argv[1] == "--completion":
            message = generate_completion_message()
            if message:
                print(message)
            else:
                print("Error generating completion message")
        elif sys.argv[1] == "--agent-name":
            # Generate agent name (no input needed)
            name = generate_agent_name()
            print(name)
        else:
            prompt_text = " ".join(sys.argv[1:])
            response = prompt_llm(prompt_text)
            if response:
                print(response)
            else:
                print("Error calling Ollama API")
    else:
        print(
            "Usage: ./ollama.py 'your prompt here' or ./ollama.py --completion or ./ollama.py --agent-name"
        )


if __name__ == "__main__":
    main()
