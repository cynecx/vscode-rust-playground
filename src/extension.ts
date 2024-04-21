import querystring from "node:querystring";
import * as vscode from "vscode";
import { CodeLensProvider } from "./codelens";
import { PlaygroundCommand } from "./command";
import { Env } from "./env";

class PlaygroundTextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private readonly env: Env) {}

    provideTextDocumentContent(
        uri: vscode.Uri,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<string> {
        const args = querystring.parse(uri.query);
        const rawInnerUri = args["innerUri"];
        if (typeof rawInnerUri !== "string") {
            return null;
        }
        return this.env.getMappedDocument(vscode.Uri.parse(rawInnerUri))?.content ?? null;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this.env.mappedDocumentEventEmitter.event;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('extension "vscode-rust-playground" is now active!');

    const env = new Env();

    context.subscriptions.push(
        env,
        vscode.workspace.onDidCloseTextDocument((document) => {
            let uri = document.uri;
            if (uri.scheme === "vscode-rust-playground") {
                const args = querystring.parse(uri.query);
                const rawInnerUri = args["innerUri"];
                if (typeof rawInnerUri === "string") {
                    uri = vscode.Uri.parse(rawInnerUri);
                }
            }
            env.removeMappedDocument(uri);
        }),
        vscode.workspace.registerTextDocumentContentProvider(
            "vscode-rust-playground",
            new PlaygroundTextDocumentContentProvider(env),
        ),
        vscode.commands.registerCommand("vscode-rust-playground.execute", (cmd: any) => {
            if (cmd instanceof PlaygroundCommand) {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        cancellable: true,
                    },
                    async (progress, token) => {
                        progress.report({
                            message: cmd.name(),
                        });
                        await cmd.execute(token);
                    },
                );
            }
        }),
        vscode.languages.registerCodeLensProvider("rust-playground", new CodeLensProvider(env)),
    );
}

export function deactivate() {}
