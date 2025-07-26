import React, { useState, useCallback, useRef } from 'react';
import { X, Youtube, Instagram, Music, FileText, Image, Link, Mic, Upload, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useDropzone } from 'react-dropzone';
import { Platform } from '../types';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: {
    type: string;
    title: string;
    url?: string;
    content?: string;
    platform?: Platform;
  }) => void;
  type?: string;
}

const platformOptions: { value: Platform; label: string; icon: React.ElementType }[] = [
  { value: 'youtube', label: 'YouTube', icon: Youtube },
  { value: 'instagram', label: 'Instagram', icon: Instagram },
  { value: 'tiktok', label: 'TikTok', icon: Music },
  { value: 'linkedin', label: 'LinkedIn', icon: Link },
  { value: 'facebook', label: 'Facebook Ads', icon: Link },
];

// Import the new components
import { DocumentUploadSection } from './DocumentUploadSection';
import { AudioRecordingSection } from './AudioRecordingSection';
import { ImageDropzone } from './ImageDropzone';
import { SocialContentInput } from './SocialContentInput';
import { URLInput } from './URLInput';

export const AddResourceModal: React.FC<AddResourceModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  type = 'url',
}) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState<Platform>('youtube');
  const [isRecording, setIsRecording] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  
  const { execute: uploadFile, loading: uploading } = useApi(ApiService.uploadResource);
  const { execute: processUrl, loading: processingUrl } = useApi(ApiService.processURL);
  const { execute: processText, loading: processingText } = useApi(ApiService.processText);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    try {
      if (type === 'url' || type === 'web') {
        if (!url || !title) return;
        const resource = await processUrl(url, platform);
        onAdd(resource);
      } else if (type === 'text') {
        if (!title || !content) return;
        const resource = await processText(title, content);
        onAdd(resource);
      } else if (type === 'voice' && audioChunks.current.length > 0) {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
        const resource = await uploadFile(audioFile);
        onAdd(resource);
      } else if (type === 'documents' && files.length > 0) {
        for (const file of files) {
          const resource = await uploadFile(file);
          onAdd(resource);
        }
      }
      
      // Reset form
      setUrl('');
      setTitle('');
      setContent('');
      setFiles([]);
      audioChunks.current = [];
      onClose();
    } catch (error) {
      console.error('Error processing resource:', error);
    }
  }, [type, url, title, content, platform, files, onAdd, onClose, processUrl, processText, uploadFile]);

  const handleMultipleImages = useCallback(async (imageFiles: File[]) => {
    try {
      for (const file of imageFiles) {
        const resource = await uploadFile(file);
        onAdd({
          type: 'image',
          title: file.name,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          },
        });
      }
      onClose();
    } catch (error) {
      console.error('Error uploading images:', error);
    }
  }, [uploadFile, onAdd, onClose]);

  const handleToggleRecording = useCallback(async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder.current = new MediaRecorder(stream);
        audioChunks.current = [];
        
        mediaRecorder.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.current.push(event.data);
          }
        };
        
        mediaRecorder.current.onstop = async () => {
          // Recording has stopped, audio data is ready
          if (audioChunks.current.length > 0) {
            console.log('Audio recording ready, chunks:', audioChunks.current.length);
          }
        };
        
        mediaRecorder.current.start();
        setIsRecording(true);
      } catch (error) {
        console.error('Error starting recording:', error);
      }
    } else {
      if (mediaRecorder.current) {
        mediaRecorder.current.stop();
        mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
      }
    }
  }, [isRecording]);

  // Listen for upload progress events
  React.useEffect(() => {
    const handleProgress = (event: CustomEvent) => {
      setUploadProgress(event.detail.percentCompleted);
    };
    
    window.addEventListener('upload-progress', handleProgress as any);
    return () => window.removeEventListener('upload-progress', handleProgress as any);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {type === 'social' && 'Add Social Media Content'}
            {type === 'web' && 'Add URL'}
            {type === 'text' && 'Add Text'}
            {type === 'voice' && 'Record Voice'}
            {type === 'image' && 'Add Images'}
            {type === 'documents' && 'Upload Documents'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {type === 'social' && (
            <div className="space-y-4">
              <SocialContentInput onAdd={(data) => {
                onAdd(data);
                onClose();
              }} />
            </div>
          )}

          {type === 'web' && (
            <div className="space-y-4">
              <URLInput onAdd={(data) => {
                onAdd(data);
                onClose();
              }} />
            </div>
          )}

          {type === 'image' && (
            <div className="space-y-4">
              <ImageDropzone onImagesSelected={setFiles} />
              <button
                onClick={() => handleMultipleImages(files)}
                disabled={uploading || files.length === 0}
                className={clsx(
                  'w-full py-2 px-4 rounded-lg transition-colors font-medium flex items-center justify-center gap-2',
                  uploading || files.length === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? 'Processing...' : `Add ${files.length} Image${files.length !== 1 ? 's' : ''} to Board`}
              </button>
            </div>
          )}

          {type === 'voice' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <AudioRecordingSection
                isRecording={isRecording}
                onToggleRecording={handleToggleRecording}
              />
              <button
                type="submit"
                disabled={uploading || !audioChunks.current.length}
                className={clsx(
                  'w-full py-2 px-4 rounded-lg transition-colors font-medium flex items-center justify-center gap-2',
                  uploading || !audioChunks.current.length
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? 'Processing...' : 'Add to Board'}
              </button>
            </form>
          )}

          {type === 'documents' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocumentUploadSection 
                files={files}
                setFiles={setFiles}
                uploadProgress={uploadProgress}
              />
              <button
                type="submit"
                disabled={uploading || files.length === 0}
                className={clsx(
                  'w-full py-2 px-4 rounded-lg transition-colors font-medium flex items-center justify-center gap-2',
                  uploading || files.length === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? 'Processing...' : 'Add to Board'}
              </button>
            </form>
          )}


          {type === 'text' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter a title..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter your text content..."
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={processingText || !title || !content}
                className={clsx(
                  'w-full py-2 px-4 rounded-lg transition-colors font-medium flex items-center justify-center gap-2',
                  processingText || !title || !content
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                {processingText && <Loader2 className="w-4 h-4 animate-spin" />}
                {processingText ? 'Processing...' : 'Add to Board'}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};