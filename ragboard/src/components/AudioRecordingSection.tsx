import React, { useState, useEffect } from 'react';
import { Mic, Square, Pause, Play } from 'lucide-react';
import { clsx } from 'clsx';

interface AudioRecordingSectionProps {
  isRecording: boolean;
  onToggleRecording: () => void;
}

export const AudioRecordingSection: React.FC<AudioRecordingSectionProps> = ({
  isRecording,
  onToggleRecording,
}) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingTime(0);
      setIsPaused(false);
    }
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="text-center py-8">
      <div className="relative inline-block">
        <button
          type="button"
          onClick={onToggleRecording}
          className={clsx(
            'w-24 h-24 rounded-full flex items-center justify-center transition-all',
            isRecording
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-purple-600 hover:bg-purple-700'
          )}
        >
          {isRecording ? (
            <Square className="w-8 h-8 text-white" />
          ) : (
            <Mic className="w-8 h-8 text-white" />
          )}
        </button>
        
        {isRecording && (
          <div className="absolute -inset-1 rounded-full border-2 border-red-500 animate-pulse" />
        )}
      </div>
      
      <div className="mt-6 space-y-2">
        {isRecording ? (
          <>
            <p className="text-lg font-medium text-gray-900">
              {formatTime(recordingTime)}
            </p>
            <p className="text-sm text-gray-600">
              Recording in progress... Click to stop
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs text-gray-500">Recording</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Click to start recording
            </p>
            <p className="text-xs text-gray-500">
              Requires microphone permission
            </p>
          </>
        )}
      </div>
      
      {isRecording && (
        <div className="mt-6">
          <div className="w-full max-w-xs mx-auto">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-200 rounded-full h-1 overflow-hidden">
                <div className="h-full bg-red-500 animate-audio-wave" />
              </div>
              <div className="flex-1 bg-gray-200 rounded-full h-1 overflow-hidden">
                <div className="h-full bg-red-500 animate-audio-wave animation-delay-100" />
              </div>
              <div className="flex-1 bg-gray-200 rounded-full h-1 overflow-hidden">
                <div className="h-full bg-red-500 animate-audio-wave animation-delay-200" />
              </div>
              <div className="flex-1 bg-gray-200 rounded-full h-1 overflow-hidden">
                <div className="h-full bg-red-500 animate-audio-wave animation-delay-300" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};