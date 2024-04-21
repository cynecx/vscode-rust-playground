import nodeChildProcess, { ExecException } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import util from "node:util";
import * as vscode from "vscode";
import { PlaygroundCommand } from "../command";
import { Env } from "../env";
import { withCleanupScope } from "../fs";
import { extractContentAt, parseOptionLineAt } from "../pattern";

const child_process = {
    exec: util.promisify(nodeChildProcess.exec),
};

export class RunSnippetCommand extends PlaygroundCommand {
    constructor(
        public readonly env: Env,
        public readonly document: vscode.TextDocument,
        public readonly line: number,
    ) {
        super();
    }

    name(): string {
        return "Running snippet";
    }

    async execute(cancellationToken: vscode.CancellationToken) {
        const optionLine = parseOptionLineAt(this.document, this.line);
        if (optionLine instanceof Error) {
            vscode.window.showWarningMessage(optionLine.message);
            return;
        }

        let profile: "debug" | "release" | null = null;
        let edition: "2021" | "2024" | null = null;
        let channel: "stable" | "nightly" | null = null;

        for (const optionString of optionLine.split(",")) {
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
                        `Options contains invalid options ('${trimmed}').`,
                    );
                    return;
            }
        }

        // Defaults
        edition ||= "2021";
        channel ||= "stable";
        profile ||= "debug";

        const snippet = extractContentAt(this.document, this.line);

        const abortController = new AbortController();
        const disposeAbortSignal = cancellationToken.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            const tempDir = await this.env.getOrInitTempDir();

            const output = await withCleanupScope(
                tempDir,
                async (tempPath, tempPathFor, deferCleanupFor) => {
                    let output = "";

                    const commonPrefix = crypto.randomUUID();

                    const sourceFileName = `${commonPrefix}.rs`;
                    const sourceFilePath = tempPathFor(sourceFileName);
                    deferCleanupFor(sourceFileName);

                    await fs.writeFile(sourceFilePath, snippet);

                    const outFileName = `${commonPrefix}.bin`;
                    const outFilePath = tempPathFor(outFileName);
                    deferCleanupFor(outFileName);
                    deferCleanupFor(`${outFileName}.dSYM`, true);

                    const buildCmd = `rustc +${channel} --color=always --edition=${edition} -g ${
                        profile === "release" ? "-O" : ""
                    } -o ${outFilePath} ${sourceFilePath}`;

                    output += `> ${buildCmd}\n\n`;

                    const buildProcess = child_process.exec(buildCmd, {
                        cwd: tempPath,
                        signal: abortController.signal,
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
                        signal: abortController.signal,
                        env: {
                            RUST_BACKTRACE: "1",
                        },
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
                },
            );

            await this.env.openAnsiContent(output, this.document);
        } finally {
            disposeAbortSignal.dispose();
        }
    }
}
