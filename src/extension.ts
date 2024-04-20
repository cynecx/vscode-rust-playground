import * as vscode from "vscode";
import util from "node:util";
import node_child_process, { ExecException } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import querystring from "node:querystring";

const child_process = {
    exec: util.promisify(node_child_process.exec),
};

const RustOptionLineStartRegex: RegExp = /^\s*\/\/\s*rustc?\s*:/i;
const RustOptionLineRegex = /^\s*\/\/\s*rustc?\s*:\s*(.*)\s*$/i;

type MappedDocument = { content?: string };

class Env {
    private tempPath: string | null = null;

    public readonly mappedDocumentEventEmitter: vscode.EventEmitter<vscode.Uri> =
        new vscode.EventEmitter<vscode.Uri>();

    private readonly mappedDocuments: Map<string, MappedDocument> = new Map();

    constructor() {}

    getMappedDocument(uri: vscode.Uri, orInsert?: boolean): MappedDocument | undefined {
        const key = uri.toString();
        let mappedDocument = this.mappedDocuments.get(key);
        if (orInsert && !mappedDocument) {
            mappedDocument = {};
            this.mappedDocuments.set(key, mappedDocument);
        }
        return mappedDocument;
    }

    removeMappedDocument(uri: vscode.Uri) {
        this.mappedDocuments.delete(uri.toString());
    }

    async getOrInitTempDir(): Promise<string> {
        if (this.tempPath) {
            try {
                await fs.access(this.tempPath);
                return this.tempPath;
            } catch {
                // Fallthrough.
            }
        }

        this.tempPath = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-rust-playground-"));
        return this.tempPath;
    }

    async cleanupScope<R>(
        cb: (tempPath: string, deferCleanupFor: (fileName: string) => void) => Promise<R>
    ): Promise<R> {
        const tempPath = await this.getOrInitTempDir();

        const filesToCleanup: string[] = [];
        const deferCleanupFor = (fileName: string) => filesToCleanup.push(fileName);

        try {
            return await cb(tempPath, deferCleanupFor);
        } finally {
            for (const fileName of filesToCleanup) {
                const filePath = path.join(tempPath, fileName);
                try {
                    await fs.rm(filePath);
                } catch {
                    // Silently ignore cleanup errors.
                }
            }
        }
    }
}

class RunSnippetArgs {
    constructor(
        public readonly env: Env,
        public readonly document: vscode.TextDocument,
        public readonly line: number
    ) {}

    async execute() {
        if (this.line >= this.document.lineCount) {
            vscode.window.showWarningMessage("Invalid command (line is out-of-bounds).");
            return;
        }

        const optionsLine = this.document.lineAt(this.line).text;
        const optionsMatch = optionsLine.match(RustOptionLineRegex);
        if (!optionsMatch) {
            vscode.window.showWarningMessage("Options string is invalid.");
            return;
        }

        let profile: "debug" | "release" | null = null;
        let edition: "2021" | "2024" | null = null;
        let channel: "stable" | "nightly" | null = null;

        for (const optionString of optionsMatch[1].split(",")) {
            const trimmed = optionString.trim().toLowerCase();
            if (!trimmed) {
                continue;
            }

            switch (trimmed) {
                case "2021":
                case "2024":
                    edition = trimmed;
                    break;
                case "stable":
                case "nightly":
                    channel = trimmed;
                    break;
                case "debug":
                case "release":
                    profile = trimmed;
                    break;
                default:
                    vscode.window.showWarningMessage(
                        `Options contains invalid options ('${trimmed}').`
                    );
                    return;
            }
        }

        // Defaults
        edition ||= "2021";
        channel ||= "stable";
        profile ||= "debug";

        let snippet = "";
        for (let lineIdx = this.line + 1; lineIdx < this.document.lineCount; lineIdx += 1) {
            const line = this.document.lineAt(lineIdx).text;
            if (line.match(RustOptionLineStartRegex)) {
                break;
            }
            snippet += line;
            snippet += "\n";
        }

        const openResultDocument = async (content: string) => {
            const documentUri = this.document.uri;

            const mappedDocument = this.env.getMappedDocument(documentUri, true);
            mappedDocument!.content = content;

            const origFileName = path.basename(`${this.document.uri.path}`);
            const newFileName = `Playground - ${origFileName}`;
            const uri = vscode.Uri.parse(
                `vscode-rust-playground:${newFileName}?${querystring.stringify({
                    innerUri: documentUri.toString(),
                })}`
            );

            const openedDocument = await vscode.workspace.openTextDocument(uri);
            vscode.window.showTextDocument(openedDocument, {
                viewColumn: vscode.ViewColumn.Beside,
            });

            this.env.mappedDocumentEventEmitter.fire(uri);
        };

        const output = await this.env.cleanupScope(async (tempPath, deferCleanupFor) => {
            let output = "";

            const commonPrefix = crypto.randomUUID();

            const sourceFileName = `${commonPrefix}.rs`;
            const sourceFilePath = path.join(tempPath, sourceFileName);
            deferCleanupFor(sourceFileName);

            await fs.writeFile(sourceFilePath, snippet);

            const outFileName = `${commonPrefix}.bin`;
            const outFilePath = path.join(tempPath, outFileName);
            deferCleanupFor(outFileName);

            const buildCmd = `rustc +${channel} --edition=${edition} -g ${
                profile === "release" ? "-O" : ""
            } -o ${outFilePath} ${sourceFilePath}`;

            output += `> ${buildCmd}\n\n`;

            const buildProcess = child_process.exec(buildCmd, {
                cwd: tempPath,
            });
            try {
                const result = await buildProcess;
                output += result.stdout;
                output += result.stderr;
                output += `\nprocess exit code: 0`;
            } catch (ex) {
                const error = ex as ExecException;
                output += (error as any).stdout;
                output += (error as any).stderr;
                output += `\nprocess exit code: ${error.code}`;
            }

            output += `\n\n> ${outFilePath}\n\n`;

            const runProcess = child_process.exec(outFilePath, {
                cwd: tempPath,
            });
            try {
                const result = await runProcess;
                output += result.stdout;
                output += result.stderr;
                output += `\nprocess exit code: 0`;
            } catch (ex) {
                const error = ex as ExecException;
                output += (error as any).stdout;
                output += (error as any).stderr;
                output += `\nprocess exit code: ${error.code}`;
            }

            return output;
        });

        openResultDocument(output);
    }
}

class ResultTCDP implements vscode.TextDocumentContentProvider {
    constructor(private readonly env: Env) {}

    provideTextDocumentContent(
        uri: vscode.Uri,
        _token: vscode.CancellationToken
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

class CodeLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly env: Env) {}

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
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
                    command: "vscode-rust-playground.run",
                    arguments: [new RunSnippetArgs(this.env, document, range.start.line)],
                })
            );
        }

        return lenses;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('extension "vscode-rust-playground" is now active!');

    const env = new Env();

    context.subscriptions.push(
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
        })
    );

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            "vscode-rust-playground",
            new ResultTCDP(env)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-rust-playground.run", (runSnippetArgs: any) => {
            if (runSnippetArgs instanceof RunSnippetArgs) {
                runSnippetArgs.execute();
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider("rust-playground", new CodeLensProvider(env))
    );
}

export function deactivate() {}
