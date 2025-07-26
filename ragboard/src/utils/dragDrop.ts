export const extractUrlFromText = (text: string): string | null => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
};

export const getPlatformFromUrl = (url: string): string | null => {
  const platforms = {
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'linkedin.com': 'linkedin',
    'facebook.com': 'facebook',
    'twitter.com': 'twitter',
    'x.com': 'twitter',
  };

  for (const [domain, platform] of Object.entries(platforms)) {
    if (url.includes(domain)) {
      return platform;
    }
  }

  return null;
};

export const extractTitleFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const parts = pathname.split('/').filter(Boolean);
    
    if (parts.length > 0) {
      return parts[parts.length - 1].replace(/-/g, ' ');
    }
    
    return urlObj.hostname;
  } catch {
    return 'Web Link';
  }
};

export const generateNodeId = (type: string): string => {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const getDropPosition = (event: React.DragEvent, reactFlowInstance: any): { x: number; y: number } => {
  const reactFlowBounds = event.currentTarget.getBoundingClientRect();
  const position = reactFlowInstance.project({
    x: event.clientX - reactFlowBounds.left,
    y: event.clientY - reactFlowBounds.top,
  });
  
  return position;
};