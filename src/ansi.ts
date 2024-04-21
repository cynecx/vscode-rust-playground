import * as vscode from "vscode";

import { Color as AnsiSeqColor, ColorName, parseAnsiSequences } from "ansi-sequence-parser";
import { Env } from "./env";

type ColorMap = Partial<Record<ColorName, vscode.ThemeColor>>;

const AnsiColors: ColorMap = {
    black: new vscode.ThemeColor("terminal.ansiBlack"),
    red: new vscode.ThemeColor("terminal.ansiRed"),
    green: new vscode.ThemeColor("terminal.ansiGreen"),
    yellow: new vscode.ThemeColor("terminal.ansiYellow"),
    blue: new vscode.ThemeColor("terminal.ansiBlue"),
    magenta: new vscode.ThemeColor("terminal.ansiMagenta"),
    cyan: new vscode.ThemeColor("terminal.ansiCyan"),
    white: new vscode.ThemeColor("terminal.ansiWhite"),
    brightBlack: new vscode.ThemeColor("terminal.ansiBrightBlack"),
    brightRed: new vscode.ThemeColor("terminal.ansiBrightRed"),
    brightGreen: new vscode.ThemeColor("terminal.ansiBrightGreen"),
    brightYellow: new vscode.ThemeColor("terminal.ansiBrightYellow"),
    brightBlue: new vscode.ThemeColor("terminal.ansiBrightBlue"),
    brightMagenta: new vscode.ThemeColor("terminal.ansiBrightMagenta"),
    brightCyan: new vscode.ThemeColor("terminal.ansiBrightCyan"),
    brightWhite: new vscode.ThemeColor("terminal.ansiBrightWhite"),
};

const AllAnsiColors: vscode.ThemeColor[] = [...(Object.values(AnsiColors) as vscode.ThemeColor[])];

function getVSCodeColor(color: AnsiSeqColor): vscode.ThemeColor | undefined {
    if (color.type === "named") {
        return AnsiColors[color.name];
    } else if (color.type === "table") {
        return AllAnsiColors[color.index];
    } else {
        // TODO
        return;
    }
}

export class AnsiColor {
    constructor(
        public readonly color: vscode.ThemeColor | undefined,
        public readonly bgColor: vscode.ThemeColor | undefined,
        public readonly bold: boolean,
        public readonly italic: boolean,
        public readonly underline: boolean,
        public readonly dim: boolean,
        public readonly inverse: boolean,
    ) {}

    toDecoratorRenderOptions(): vscode.DecorationRenderOptions {
        const style = this;
        const decoratorRenderOptions: vscode.DecorationRenderOptions = {};

        if (style.bold) {
            decoratorRenderOptions.fontWeight = "bold";
        }
        if (style.italic) {
            decoratorRenderOptions.fontStyle = "italic";
        }
        if (style.underline) {
            decoratorRenderOptions.textDecoration = "underline";
        }
        if (style.dim) {
            decoratorRenderOptions.opacity = "50%";
        }
        if (style.color) {
            if (style.inverse) {
                decoratorRenderOptions.backgroundColor = style.color;
            } else {
                decoratorRenderOptions.color = style.color;
            }
        }
        if (style.bgColor) {
            if (style.inverse) {
                decoratorRenderOptions.color = style.bgColor;
            } else {
                decoratorRenderOptions.backgroundColor = style.bgColor;
            }
        }

        return decoratorRenderOptions;
    }

    hash(): string {
        return JSON.stringify(this);
    }
}

function computeLastLine(content: string): { lines: number; lastLineOffset: number } {
    let offset = 0;
    let lines = 0;

    while (offset < content.length) {
        const pos = content.substring(offset).indexOf("\n");
        if (pos < 0) {
            break;
        }

        const start = offset;
        const end = start + pos + 1;

        offset = end;
        lines += 1;
    }

    return {
        lines,
        lastLineOffset: offset,
    };
}

export function parse(
    env: Env,
    content: string,
): {
    decorations: {
        decorationType: vscode.TextEditorDecorationType;
        range: vscode.Range;
    }[];
    content: string;
} {
    const spans = parseAnsiSequences(content);

    let cleanedContent = "";
    let currentLine = 0;
    let currentColumn = 0;

    const decorations: {
        decorationType: vscode.TextEditorDecorationType;
        range: vscode.Range;
    }[] = [];

    for (const span of spans) {
        const { lines, lastLineOffset } = computeLastLine(span.value);

        let endLine: number;
        let endColumn: number;

        if (lines) {
            endLine = currentLine + lines;
            endColumn = span.value.length - lastLineOffset;
        } else {
            endLine = currentLine;
            endColumn = currentColumn + span.value.length;
        }

        const hasDecoration = !!span.decorations.size || !!span.foreground || !!span.background;
        if (hasDecoration) {
            const range = new vscode.Range(
                new vscode.Position(currentLine, currentColumn),
                new vscode.Position(endLine, endColumn),
            );

            const ansiColor = new AnsiColor(
                span.foreground ? getVSCodeColor(span.foreground) : undefined,
                span.background ? getVSCodeColor(span.background) : undefined,
                span.decorations.has("bold"),
                span.decorations.has("italic"),
                span.decorations.has("underline"),
                span.decorations.has("dim"),
                span.decorations.has("reverse"),
            );

            decorations.push({
                range,
                decorationType: env.getOrRegisterDecoratorStyle(ansiColor),
            });
        }

        currentLine = endLine;
        currentColumn = endColumn;
        cleanedContent += span.value;
    }

    return {
        content: cleanedContent,
        decorations,
    };
}
