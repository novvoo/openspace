declare global {
    interface Window {
        go: {
            main: {
                App: {
                    GetServerStatus(): Promise<string>;
                    GetProjects(): Promise<string>;
                    GetCurrentProject(): Promise<string>;
                    GetSessions(): Promise<string>;
                    CreateSession(title: string, parentID: string): Promise<string>;
                    SendMessage(sessionId: string, message: string, model: string, agent: string): Promise<string>;
                    SendMessageAsync(sessionId: string, message: string, model: string, agent: string): Promise<string>;
                    GetFiles(path: string): Promise<string>;
                    GetFileContent(path: string): Promise<string>;
                    RestartServer(): Promise<void>;
                    Greet(name: string): Promise<string>;
                    GetSessionStatus(): Promise<string>;
                    GetSessionDetails(sessionID: string): Promise<string>;
                    GetSessionMessages(sessionID: string, limit: string): Promise<string>;
                    GetSessionChildren(sessionID: string): Promise<string>;
                    GetSessionTodo(sessionID: string): Promise<string>;
                    GetSessionDiff(sessionID: string, messageID: string): Promise<string>;
                    DeleteSession(sessionID: string): Promise<string>;
                    UpdateSession(sessionID: string, title: string): Promise<string>;
                    AbortSession(sessionID: string): Promise<string>;
                    SummarizeSession(sessionID: string, providerID: string, modelID: string): Promise<string>;
                    FindFilesByName(query: string, fileType: string, limit: number): Promise<string>;
                    FindText(pattern: string): Promise<string>;
                    FindSymbol(query: string): Promise<string>;
                    GetFileStatus(): Promise<string>;
                    GetConfig(): Promise<string>;
                    UpdateConfig(jsonData: string): Promise<string>;
                    GetProviders(): Promise<string>;
                    ListProviders(): Promise<string>;
                    GetProviderAuth(): Promise<string>;
                    GetAgents(): Promise<string>;
                    GetCommands(): Promise<string>;
                    GetVCSInfo(): Promise<string>;
                    GetPath(): Promise<string>;
                    SubmitPrompt(): Promise<string>;
                    ClearPrompt(): Promise<string>;
                    OpenCurrentDirectory(): Promise<void>;
                    StartOpenSpaceServer(): Promise<void>;
                    StopOpenSpaceServer(): Promise<void>;
                };
            };
        };
    }
}

export { };
