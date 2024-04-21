import * as vscode from "vscode";

export abstract class PlaygroundCommand {
    abstract name(): string;

    abstract execute(cancellationToken: vscode.CancellationToken): Promise<void>;
}
