import nodeChildProcess, { ExecException } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import util from "node:util";
import * as vscode from "vscode";
import { wrapText } from "../ansi";
import { PlaygroundCommand } from "../command";
import { Env } from "../env";
import { CleanupScopeCallback, withCleanupScope } from "../fs";
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
        let edition: "2018" | "2021" | "2024" | null = null;
        let channel: "stable" | "nightly" | null = null;
        let verbose: "verbose" | null = null;

        for (const optionString of optionLine.split(",")) {
            const trimmed = optionString.trim().toLowerCase();
            if (!trimmed) {
                continue;
            }

            switch (trimmed) {
                case "2018":
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
                case "verbose":
                    verbose = trimmed;
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

        if (edition === "2024") {
            channel = "nightly";
        }

        const snippet = extractContentAt(this.document, this.line);

        const abortController = new AbortController();
        const disposeAbortSignal = cancellationToken.onCancellationRequested(() => {
            abortController.abort();
        });

        const execute: CleanupScopeCallback<[output: string, tempPath: string]> = async (
            tempPath,
            tempPathFor,
            deferCleanupFor,
        ) => {
            let output = "";

            const commonPrefix = crypto.randomUUID().replaceAll("-", "").substring(0, 12);

            const sourceFileName = `${commonPrefix}.rs`;
            const sourceFilePath = tempPathFor(sourceFileName);
            deferCleanupFor(sourceFileName);

            await fs.writeFile(sourceFilePath, snippet);

            const outFileName = `${commonPrefix}.bin`;
            const outFilePath = tempPathFor(outFileName);
            deferCleanupFor(outFileName);
            deferCleanupFor(`${outFileName}.dSYM`, true);

            let buildCmdParts = ["rustc"];

            buildCmdParts.push(`+${channel}`);
            buildCmdParts.push(`--edition=${edition}`);
            if (channel === "nightly") {
                buildCmdParts.push("-Zunstable-options");
            }
            if (profile === "release") {
                buildCmdParts.push("-O");
            }
            buildCmdParts.push("-g");
            buildCmdParts.push("--color=always");
            buildCmdParts.push(`-o ${outFilePath}`);
            buildCmdParts.push(sourceFilePath);

            const buildCmd = buildCmdParts.join(" ");

            output += wrapText(`> ${buildCmd}\n\n`, { dim: true });

            const buildProcess = child_process.exec(buildCmd, {
                cwd: tempPath,
                signal: abortController.signal,
            });

            let exitCode: number;

            try {
                const result = await buildProcess;
                output += result.stdout;
                output += result.stderr;
                output += wrapText(`\nprocess exit code: 0`, {
                    bold: true,
                    dim: true,
                    italic: true,
                });

                exitCode = buildProcess.child.exitCode ?? -1;
            } catch (ex) {
                const error = ex as ExecException;
                output += (error as any).stdout;
                output += (error as any).stderr;
                output += wrapText(`\nprocess exit code: ${error.code}`, {
                    bold: true,
                    dim: true,
                    italic: true,
                });

                exitCode = error.code ?? -1;
            }

            if (exitCode !== 0) {
                return [output, tempPath];
            }

            output += wrapText(`\n\n> ${outFilePath}\n\n`, { dim: true });

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
                output += wrapText(`\nprocess exit code: 0`, {
                    bold: true,
                    dim: true,
                    italic: true,
                });
            } catch (ex) {
                const error = ex as ExecException;
                output += (error as any).stdout;
                output += (error as any).stderr;
                output += wrapText(`\nprocess exit code: ${error.code}`, {
                    bold: true,
                    dim: true,
                    italic: true,
                });
            }

            return [output, tempPath];
        };

        try {
            let [output, tempPath] = await withCleanupScope(
                await this.env.getOrInitTempDir(),
                execute,
            );

            if (!verbose) {
                output = output.replaceAll(tempPath, "/rust-playground");
            }

            await this.env.openAnsiContent(output, this.document);
        } finally {
            disposeAbortSignal.dispose();
        }
    }
}
