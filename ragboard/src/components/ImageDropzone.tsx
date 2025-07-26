import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Image, Upload } from 'lucide-react';

interface ImageDropzoneProps {
  onImagesSelected: (images: File[]) => void;
}

export const ImageDropzone: React.FC<ImageDropzoneProps> = ({ onImagesSelected }) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    onImagesSelected(acceptedFiles);
  }, [onImagesSelected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    },
    multiple: true
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragActive ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400'}
      `}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
          {isDragActive ? <Upload className="w-6 h-6 text-purple-600" /> : <Image className="w-6 h-6 text-purple-600" />}
        </div>
        <div>
          <p className="text-gray-700 font-medium">
            {isDragActive ? 'Drop images here...' : 'Drag & drop images here'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            or click to select multiple images
          </p>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Supports PNG, JPG, GIF, WebP, SVG
        </p>
      </div>
    </div>
  );
};