import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import querystring from "node:querystring";
import * as vscode from "vscode";
import { AnsiColor, parse as parseAnsi } from "./ansi";
import { groupBy } from "./utils";

export type MappedDocument = { content?: string };

export class Env implements vscode.Disposable {
    private tempPath: string | null = null;

    public readonly mappedDocumentEventEmitter: vscode.EventEmitter<vscode.Uri> =
        new vscode.EventEmitter<vscode.Uri>();

    private readonly mappedDocuments: Map<string, MappedDocument> = new Map();

    private readonly textEditorDecoratorStyleTypes: Map<string, vscode.TextEditorDecorationType> =
        new Map();

    private disposables: vscode.Disposable[] | null = [];

    constructor() {}

    dispose() {
        const disposables = this.disposables;
        if (!disposables) {
            return;
        }

        this.disposables = null;

        for (const disposable of disposables) {
            disposable.dispose();
        }
    }

    getOrRegisterDecoratorStyle(style: AnsiColor): vscode.TextEditorDecorationType {
        if (!this.disposables) {
            throw new Error("Can't register decorator style because this env has been disposed.");
        }

        const hash = style.hash();

        const styleType = this.textEditorDecoratorStyleTypes.get(hash);
        if (styleType) {
            return styleType;
        }

        const decoratorType = vscode.window.createTextEditorDecorationType(
            style.toDecoratorRenderOptions(),
        );

        this.textEditorDecoratorStyleTypes.set(hash, decoratorType);
        this.disposables.push(decoratorType);

        return decoratorType;
    }

    registeredDecoratorStyleTypes(): Iterable<vscode.TextEditorDecorationType> {
        return this.textEditorDecoratorStyleTypes.values();
    }

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

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-rust-playground-"));
        const resolvedTempDir = path.resolve(tempDir);

        this.tempPath = resolvedTempDir;

        return resolvedTempDir;
    }

    async openAnsiContent(ansiContent: string, forTextDocument: vscode.TextDocument) {
        const parsed = parseAnsi(this, ansiContent);

        const documentUri = forTextDocument.uri;

        const mappedDocument = this.getMappedDocument(documentUri, true);
        mappedDocument!.content = parsed.content;

        const origFileName = path.basename(`${documentUri.path}`);
        const newFileName = `Playground - ${origFileName}`;

        const uri = vscode.Uri.parse(
            `vscode-rust-playground:${newFileName}?${querystring.stringify({
                innerUri: documentUri.toString(),
            })}`,
        );

        const openedDocument = await vscode.workspace.openTextDocument(uri);

        this.mappedDocumentEventEmitter.fire(uri);

        const textEditor = await vscode.window.showTextDocument(openedDocument, {
            viewColumn: vscode.ViewColumn.Beside,
        });

        for (const decoratorStyleType of this.registeredDecoratorStyleTypes()) {
            textEditor.setDecorations(decoratorStyleType, []);
        }

        for (const { key, values } of groupBy(
            parsed.decorations,
            (entry) => entry.decorationType,
            (decoratorType) => decoratorType.key,
            (_key, val) => val.range,
        )) {
            textEditor.setDecorations(key, values);
        }

        this.mappedDocumentEventEmitter.fire(uri);
    }
}
