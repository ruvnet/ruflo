import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatInterface } from './components/ChatInterface';
import { VSCodeAPIProvider } from './contexts/VSCodeAPIContext';
import './style.css';

// Initialize the React app
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <VSCodeAPIProvider>
            <ChatInterface />
        </VSCodeAPIProvider>
    </React.StrictMode>
);