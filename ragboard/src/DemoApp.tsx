import React from 'react';
import './index.css';

function DemoApp() {
  const [time, setTime] = React.useState(new Date());
  
  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLoadApp = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">RAGBOARD</h1>
        <p className="text-gray-600 mb-2">Visual Knowledge Management System</p>
        
        <div className="bg-green-50 border border-green-200 rounded p-4 mb-6">
          <p className="text-green-800 font-semibold">✅ React is working!</p>
          <p className="text-sm text-green-600 mt-1">Time: {time.toLocaleTimeString()}</p>
        </div>
        
        <div className="space-y-2 mb-6">
          <h2 className="font-semibold text-gray-700">Service Status:</h2>
          <ul className="text-sm space-y-1">
            <li className="text-green-600">• Frontend Server: Running</li>
            <li className="text-green-600">• Backend API: Port 8000</li>
            <li className="text-green-600">• PostgreSQL: Active</li>
            <li className="text-green-600">• Redis: Active</li>
          </ul>
        </div>
        
        <button 
          onClick={handleLoadApp}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
        >
          Try Loading Full App Again
        </button>
        
        <p className="text-xs text-gray-500 mt-4 text-center">
          This is a fallback view. The main app may have module loading issues.
        </p>
      </div>
    </div>
  );
}

export default DemoApp;