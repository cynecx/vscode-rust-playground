import * as vscode from "vscode";

export const RustOptionLineStartRegex: RegExp = /^\s*\/\/\s*rustc?\s*:/i;
export const RustOptionLineRegex = /^\s*\/\/\s*rustc?\s*:\s*(.*)\s*$/i;

export function parseOptionLineAt(textDocument: vscode.TextDocument, line: number): string | Error {
    if (line >= textDocument.lineCount) {
        return new Error("Invalid command (line is out-of-bounds).");
    }

    const optionsLine = textDocument.lineAt(line).text;
    const optionsMatch = optionsLine.match(RustOptionLineRegex);
    if (!optionsMatch) {
        return new Error("Options string is invalid.");
    }

    return optionsMatch[1].trim();
}

export function extractContentAt(textDocument: vscode.TextDocument, startLineIdx: number): string {
    let snippet = "";
    for (let lineIdx = startLineIdx; lineIdx < textDocument.lineCount; lineIdx += 1) {
        const line = textDocument.lineAt(lineIdx).text;
        if (lineIdx !== startLineIdx && line.match(RustOptionLineStartRegex)) {
            break;
        }
        snippet += line;
        snippet += "\n";
    }

    return snippet;
}
