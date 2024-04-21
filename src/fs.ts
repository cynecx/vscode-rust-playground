import fs from "node:fs/promises";
import path from "node:path";

export async function withCleanupScope<R>(
    tempPath: string,
    cb: (
        tempPath: string,
        pathFor: (relativePath: string) => string,
        deferCleanupFor: (fileName: string, recursive?: boolean) => void,
    ) => Promise<R>,
): Promise<R> {
    const resolvedTempPath = path.resolve(tempPath);

    const pathsToCleanup: { relativePath: string; recursive?: boolean | undefined }[] = [];

    const deferCleanupFor = (relativePath: string, recursive?: boolean) =>
        pathsToCleanup.push({ relativePath, recursive });

    try {
        const pathFor = (relativePath: string) => path.join(resolvedTempPath, relativePath);
        return await cb(resolvedTempPath, pathFor, deferCleanupFor);
    } finally {
        for (const { relativePath, recursive } of pathsToCleanup) {
            const filePath = path.join(tempPath, relativePath);

            try {
                const resolvedPath = path.resolve(filePath);
                if (filePath !== resolvedPath) {
                    // Be conservative and don't do anything in this case.
                    continue;
                }

                await fs.rm(filePath, {
                    recursive: !!recursive,
                });
            } catch (ex) {
                // Silently ignore cleanup errors.
            }
        }
    }
}
