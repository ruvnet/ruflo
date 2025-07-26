import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import '@reactflow/node-resizer/dist/style.css'

// Debug logging
console.log('Starting RAGBoard application...');

// Lazy load the main app to avoid import issues
const App = React.lazy(() => 
  import('./App').catch(err => {
    console.error('Error loading App, falling back to demo:', err);
    return import('./DemoApp');
  })
);

// Wait for DOM to be ready
const initApp = () => {
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    console.error('Root element not found! Retrying...');
    setTimeout(initApp, 100);
    return;
  }

  console.log('Root element found, mounting React app...');
  
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <React.Suspense fallback={
          <div className="flex items-center justify-center h-screen">
            <div className="text-xl">Loading RAGBOARD...</div>
          </div>
        }>
          <App />
        </React.Suspense>
      </React.StrictMode>
    );
    console.log('React app mounted successfully!');
  } catch (error) {
    console.error('Error mounting React app:', error);
    // Fallback to demo app
    import('./DemoApp').then(({ default: DemoApp }) => {
      ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
          <DemoApp />
        </React.StrictMode>
      );
    });
  }
};

// Start initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}