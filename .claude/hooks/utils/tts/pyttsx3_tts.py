#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "pyttsx3",
# ]
# ///

import sys
import random

def main():
    """
    pyttsx3 TTS Script
    
    Uses pyttsx3 for offline text-to-speech synthesis.
    Accepts optional text prompt as command-line argument.
    
    Usage:
    - ./pyttsx3_tts.py                    # Uses default text
    - ./pyttsx3_tts.py "Your custom text" # Uses provided text
    
    Features:
    - Offline TTS (no API key required)
    - Cross-platform compatibility
    - Configurable voice settings
    - Immediate audio playback
    """
    
    try:
        import pyttsx3
        
        # Initialize TTS engine
        engine = pyttsx3.init()
        
        # Configure engine settings
        engine.setProperty('rate', 180)    # Speech rate (words per minute)
        engine.setProperty('volume', 0.8)  # Volume (0.0 to 1.0)
        
        print("🎙️  pyttsx3 TTS")
        print("=" * 15)
        
        # Get text from command line argument or use default
        if len(sys.argv) > 1:
            text = " ".join(sys.argv[1:])  # Join all arguments as text
        else:
            # Default completion messages
            completion_messages = [
                "Work complete!",
                "All done!",
                "Task finished!",
                "Job complete!",
                "Ready for next task!"
            ]
            text = random.choice(completion_messages)
        
        print(f"🎯 Text: {text}")
        print("🔊 Speaking...")
        
        # Speak the text
        engine.say(text)
        engine.runAndWait()
        
        print("✅ Playback complete!")
        
    except ImportError:
        print("❌ Error: pyttsx3 package not installed")
        print("This script uses UV to auto-install dependencies.")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()