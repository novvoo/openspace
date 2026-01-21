import React from 'react';
import MainLayout from './components/MainLayout';
import { ThemeProvider } from './ThemeContext';
import './app.css';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <div className="App">
        <MainLayout />
      </div>
    </ThemeProvider>
  );
};

export default App;
