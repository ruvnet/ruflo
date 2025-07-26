import React from 'react';

function SimpleApp() {
  const [count, setCount] = React.useState(0);
  
  return (
    <div style={{ 
      padding: '40px', 
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      backgroundColor: '#f0f0f0',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#333' }}>RAGBoard is Working! 🎉</h1>
      <p style={{ fontSize: '18px', color: '#666' }}>
        React is successfully running in your Codespace
      </p>
      <div style={{ margin: '30px 0' }}>
        <button 
          onClick={() => setCount(count + 1)}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Count: {count}
        </button>
      </div>
      <p style={{ color: '#999', fontSize: '14px' }}>
        Time: {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
}

export default SimpleApp;