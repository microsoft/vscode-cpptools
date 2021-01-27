import * as vscode from 'vscode';

enum DebugSessionState {
    Unknown,
    Started,
    Running,
    Stopped,
    Exited
  }

export class CppDbgDebugAdapterTracker implements vscode.DebugAdapterTracker {

    private state: DebugSessionState;

    constructor(private session: vscode.DebugSession) {
        this.state = DebugSessionState.Unknown;
    }

    sendEvaluateRequest(expression: string): Thenable<any> {
        if (this.state == DebugSessionState.Stopped)
        {
            return this.session.customRequest("evaluate", {
                expression: "-exec " + expression,
                context: "repl",
                frameId: -1
            })
            
        }
        return Promise.resolve();
    }

    sendReadMemoryRequest(address: string, offset: number, count: number): Thenable<any> {
        if (this.state == DebugSessionState.Stopped)
        {
            return this.session.customRequest("readMemory", {
                memoryReference: address,
                offset: offset,
                count: count
            })
        }
        return Promise.resolve();
    }

    /**
     * A session with the debug adapter is about to be started.
     */
    onWillStartSession?(): void {
        this.state = DebugSessionState.Started;
        console.log("Started Session")
    }
    /**
     * The debug adapter is about to receive a Debug Adapter Protocol message from VS Code.
     */
    onWillReceiveMessage?(message: any): void {
        console.log("Message Incomming!")
    }
    /**
     * The debug adapter has sent a Debug Adapter Protocol message to VS Code.
     */
    onDidSendMessage?(message: any): void {
        if (message)
        {
            console.log(message)
            switch (message.type)
            {
                case "event":
                    switch(message.event)
                    {
                        case "stopped":
                            this.state = DebugSessionState.Stopped;
                            break;
                        default:
                            break;
                    }
                case "response":
                    break
                default:
                    break;
            }
        }
    }
    /**
     * The debug adapter session is about to be stopped.
     */
    onWillStopSession?(): void {
        console.log("Stopping soon.")
    }
    /**
     * An error with the debug adapter has occurred.
     */
    onError?(error: Error): void {
        console.log("Uh oh!")
    }
    /**
     * The debug adapter has exited with the given exit code or signal.
     */
    onExit?(code: number | undefined, signal: string | undefined): void {
        console.log("Exiting!")
    }
}