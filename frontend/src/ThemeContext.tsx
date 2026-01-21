import React, { createContext, useState, useEffect, useContext } from 'react';
import { EventsOn, WindowSetBackgroundColour, WindowSetDarkTheme, WindowSetLightTheme } from '../wailsjs/runtime/runtime';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Check local storage or system preference
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('theme') as Theme;
        if (saved) return saved;
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
        return 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const applyWindowTheme = () => {
            try {
                if (theme === 'dark') {
                    WindowSetDarkTheme();
                    WindowSetBackgroundColour(26, 27, 38, 255);
                } else {
                    WindowSetLightTheme();
                    WindowSetBackgroundColour(255, 255, 255, 255);
                }
            } catch {
            }
        };

        applyWindowTheme();
        const offReady = EventsOn('wails:ready', applyWindowTheme);
        const t = window.setTimeout(applyWindowTheme, 50);
        return () => {
            window.clearTimeout(t);
            offReady?.();
        };
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
