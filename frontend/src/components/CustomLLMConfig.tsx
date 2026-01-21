import React, { useState, useEffect } from 'react';
import {
    GetCustomLLMServices,
    AddCustomLLMService,
    UpdateCustomLLMService,
    DeleteCustomLLMService,
    TestCustomLLMService
} from '../../wailsjs/go/main/App';

interface CustomLLMService {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    headers: { [key: string]: string };
    models: string[];
    defaultModel: string;
    authType: string;
    provider: string;
    enabled: boolean;
    contextLimit?: number;
}

interface CustomLLMConfigProps {
    onClose: () => void;
}

const CustomLLMConfig: React.FC<CustomLLMConfigProps> = ({ onClose }) => {
    const [services, setServices] = useState<CustomLLMService[]>([]);
    const [editingService, setEditingService] = useState<CustomLLMService | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<any>(null);

    const loadServices = async () => {
        try {
            const data = await GetCustomLLMServices();
            if (data) {
                setServices(JSON.parse(data));
            }
        } catch (e) {
            console.error('Failed to load custom LLM services:', e);
        }
    };

    useEffect(() => {
        loadServices();
    }, []);

    const handleSave = async (service: CustomLLMService) => {
        try {
            // Ensure defaultModel is in models list
            const updatedService = { ...service };
            if (updatedService.defaultModel && !updatedService.models.includes(updatedService.defaultModel)) {
                updatedService.models = [...updatedService.models, updatedService.defaultModel];
            }

            const serviceData = JSON.stringify(updatedService);
            if (isAddingNew) {
                await AddCustomLLMService(serviceData);
            } else if (editingService) {
                await UpdateCustomLLMService(editingService.id, serviceData);
            }
            await loadServices();
            setEditingService(null);
            setIsAddingNew(false);
        } catch (e) {
            console.error('Failed to save service:', e);
            alert('Failed to save service: ' + e);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this service?')) return;
        try {
            await DeleteCustomLLMService(id);
            await loadServices();
        } catch (e) {
            console.error('Failed to delete service:', e);
            alert('Failed to delete service: ' + e);
        }
    };

    const handleTest = async (service: CustomLLMService) => {
        setTesting(true);
        setTestResult(null);
        try {
            const serviceData = JSON.stringify(service);
            const result = await TestCustomLLMService(serviceData);
            setTestResult(JSON.parse(result));
        } catch (e) {
            console.error('Failed to test service:', e);
            setTestResult({
                success: false,
                error: 'Failed to test service: ' + e
            });
        } finally {
            setTesting(false);
        }
    };

    const ServiceForm: React.FC<{ service: CustomLLMService; onSave: (service: CustomLLMService) => void; onCancel: () => void }> = ({ service, onSave, onCancel }) => {
        const [formData, setFormData] = useState<CustomLLMService>(service);
        const [customModelInput, setCustomModelInput] = useState('');

        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            onSave(formData);
        };

        const handleHeaderChange = (key: string, value: string) => {
            setFormData({
                ...formData,
                headers: {
                    ...formData.headers,
                    [key]: value
                }
            });
        };

        const addHeader = () => {
            setFormData({
                ...formData,
                headers: {
                    ...formData.headers,
                    '': ''
                }
            });
        };

        const removeHeader = (key: string) => {
            const newHeaders = { ...formData.headers };
            delete newHeaders[key];
            setFormData({
                ...formData,
                headers: newHeaders
            });
        };

        // 获取所有可用的模型列表
        const getAvailableModels = () => {
            const allModels = new Set<string>();
            
            // 添加当前服务的模型
            formData.models.forEach(model => allModels.add(model));
            
            // 添加其他服务的模型
            services.forEach(svc => {
                if (svc.id !== formData.id) {
                    svc.models.forEach(model => allModels.add(model));
                }
            });
            
            // 添加一些常见的模型作为默认值
            const commonModels = [
                'gpt-3.5-turbo',
                'gpt-4',
                'gpt-4-turbo',
                'claude-3-sonnet',
                'claude-3-opus',
                'Big Pickle',
                'OpenSpace Zen'
            ];
            
            commonModels.forEach(model => allModels.add(model));
            
            return Array.from(allModels);
        };

        const handleModelSelection = (value: string) => {
            if (value === 'custom') {
                setFormData({ ...formData, defaultModel: '' });
            } else {
                setFormData({ ...formData, defaultModel: value });
            }
        };

        const handleCustomModelChange = (value: string) => {
            setCustomModelInput(value);
            setFormData({ ...formData, defaultModel: value });
        };

        const isCustomModel = formData.defaultModel && !getAvailableModels().includes(formData.defaultModel);

        return (
            <form className="CustomLLMConfig-form" onSubmit={handleSubmit}>
                <h3>{isAddingNew ? 'Add New Service' : 'Edit Service'}</h3>
                
                <div className="form-group">
                    <label>Service ID *</label>
                    <input
                        type="text"
                        value={formData.id}
                        onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                        disabled={!isAddingNew}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Service Name *</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Provider Type</label>
                    <select
                        value={formData.provider || 'openai'}
                        onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                    >
                        <option value="openai">OpenAI Compatible</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="ollama">Ollama</option>
                    </select>
                </div>

                <div className="form-group">
                    <label>Base URL *</label>
                    <input
                        type="url"
                        value={formData.baseUrl}
                        onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1/chat/completions"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>API Key</label>
                    <input
                        type="password"
                        value={formData.apiKey}
                        onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    />
                </div>

                <div className="form-group">
                    <label>Authentication Type</label>
                    <select
                        value={formData.authType}
                        onChange={(e) => setFormData({ ...formData, authType: e.target.value })}
                    >
                        <option value="apiKey">API Key</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="none">None</option>
                    </select>
                </div>

                <div className="form-group">
                    <label>Default Model *</label>
                    <select
                        value={isCustomModel ? 'custom' : formData.defaultModel}
                        onChange={(e) => handleModelSelection(e.target.value)}
                        required
                    >
                        <option value="">Select a model...</option>
                        {getAvailableModels().map((model) => (
                            <option key={model} value={model}>
                                {model}
                            </option>
                        ))}
                        <option value="custom">+ Custom Model...</option>
                    </select>
                    
                    {(isCustomModel || formData.defaultModel === '') && (
                        <input
                            type="text"
                            value={isCustomModel ? formData.defaultModel : customModelInput}
                            onChange={(e) => handleCustomModelChange(e.target.value)}
                            placeholder="Enter custom model name..."
                            required
                        />
                    )}
                </div>

                <div className="form-group">
                    <label>Custom Headers</label>
                    {Object.entries(formData.headers).map(([key, value]) => (
                        <div key={key} className="header-row">
                            <input
                                type="text"
                                value={key}
                                onChange={(e) => {
                                    const newHeaders = { ...formData.headers };
                                    delete newHeaders[key];
                                    newHeaders[e.target.value] = value;
                                    setFormData({ ...formData, headers: newHeaders });
                                }}
                                placeholder="Header Name"
                            />
                            <input
                                type="text"
                                value={value}
                                onChange={(e) => handleHeaderChange(key, e.target.value)}
                                placeholder="Header Value"
                            />
                            <button
                                type="button"
                                onClick={() => removeHeader(key)}
                                className="remove-button"
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={addHeader}
                        className="add-header-button"
                    >
                        + Add Header
                    </button>
                </div>

                <div className="form-group">
                    <label>Context Limit (Tokens)</label>
                    <input
                        type="number"
                        value={formData.contextLimit || 100000}
                        onChange={(e) => setFormData({ ...formData, contextLimit: parseInt(e.target.value) })}
                        placeholder="100000"
                    />
                </div>

                <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            checked={formData.enabled}
                            onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                        />
                        <span>Enabled</span>
                    </label>
                </div>

                <div className="form-actions">
                    <button type="submit" className="Button">
                        Save
                    </button>
                    <button type="button" onClick={onCancel}>
                        Cancel
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className="CustomLLMConfig">
            <div className="header">
                <h2>Custom LLM Services</h2>
                <button onClick={onClose} className="Button">
                    Close
                </button>
            </div>

            {(editingService || isAddingNew) && (
                <ServiceForm
                    service={editingService || {
                        id: '',
                        name: '',
                        baseUrl: '',
                        apiKey: '',
                        headers: {},
                        models: [],
                        defaultModel: '',
                        authType: 'apiKey',
                        provider: 'openai',
                        enabled: true,
                        contextLimit: 100000
                    }}
                    onSave={handleSave}
                    onCancel={() => {
                        setEditingService(null);
                        setIsAddingNew(false);
                    }}
                />
            )}

            {testResult && (
                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                    <h4>Test Result</h4>
                    <p><strong>Status:</strong> {testResult.success ? 'Success' : 'Failed'}</p>
                    {testResult.error && <p><strong>Error:</strong> {testResult.error}</p>}
                    {testResult.message && <p><strong>Message:</strong> {testResult.message}</p>}
                </div>
            )}

            <div className="panel">
                <div className="panel-header">
                    <h3>Configured Services</h3>
                    <button
                        onClick={() => setIsAddingNew(true)}
                        className="Button"
                    >
                        + Add Service
                    </button>
                </div>

                {services.length === 0 ? (
                    <p className="empty-state">
                        No custom LLM services configured. Click "Add Service" to get started.
                    </p>
                ) : (
                    <div className="services-grid">
                        {services.map((service) => (
                            <div key={service.id} className="service-card">
                                <div className="service-content">
                                    <div className="service-info">
                                        <h4>
                                            {service.name}
                                            {service.enabled && <span className="status-indicator">●</span>}
                                        </h4>
                                        <p><strong>ID:</strong> {service.id}</p>
                                        <p><strong>Provider:</strong> {service.provider || 'openai'}</p>
                                        <p><strong>URL:</strong> {service.baseUrl}</p>
                                        <p><strong>Model:</strong> {service.defaultModel}</p>
                                        <p><strong>Auth:</strong> {service.authType}</p>
                                    </div>
                                    <div className="service-actions">
                                        <button
                                            onClick={() => handleTest(service)}
                                            disabled={testing}
                                            className="test-button"
                                        >
                                            {testing ? 'Testing...' : 'Test'}
                                        </button>
                                        <button
                                            onClick={() => setEditingService(service)}
                                            className="edit-button"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(service.id)}
                                            className="delete-button"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomLLMConfig;
