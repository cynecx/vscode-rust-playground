import * as vscode from "vscode";
import { RunSnippetCommand } from "./commands/run";
import { Env } from "./env";
import { RustOptionLineStartRegex } from "./pattern";

export class CodeLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly env: Env) {}

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        let lenses: vscode.CodeLens[] = [];

        for (let i = 0; i < document.lineCount; i += 1) {
            if (token.isCancellationRequested) {
                break;
            }

            const line = document.lineAt(i);

            const match = line.text.match(RustOptionLineStartRegex);
            if (!match || typeof match.index === "undefined") {
                continue;
            }

            const start = new vscode.Position(i, match.index);
            const end = new vscode.Position(i, match.index + match[0].length);
            const range = new vscode.Range(start, end);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: "Run Snippet",
                    command: "vscode-rust-playground.execute",
                    arguments: [new RunSnippetCommand(this.env, document, range.start.line)],
                }),
            );
        }

        return lenses;
    }
}
