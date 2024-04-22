import * as vscode from "vscode";
import querystring from "node:querystring";

export function extractInnerUri(uri: vscode.Uri): vscode.Uri | null {
    if (uri.scheme !== "vscode-rust-playground") {
        return null;
    }
    const args = querystring.parse(uri.query);
    const rawInnerUri = args["innerUri"];
    if (typeof rawInnerUri !== "string") {
        return null;
    }
    return vscode.Uri.parse(rawInnerUri);
}

export function encodeInnerUri(uri: vscode.Uri, innerUri: vscode.Uri): vscode.Uri {
    return uri.with({
        query: querystring.stringify({
            innerUri: innerUri.toString(),
        }),
    });
}
