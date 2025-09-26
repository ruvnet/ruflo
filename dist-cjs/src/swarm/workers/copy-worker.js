import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
async function copyFile(file) {
    try {
        const destDir = path.dirname(file.destPath);
        await fs.mkdir(destDir, {
            recursive: true
        });
        await fs.copyFile(file.sourcePath, file.destPath);
        if (file.permissions) {
            await fs.chmod(file.destPath, file.permissions);
        }
        let hash;
        if (file.verify) {
            const content = await fs.readFile(file.destPath);
            hash = createHash('sha256').update(content).digest('hex');
        }
        return {
            success: true,
            file: file.sourcePath,
            hash
        };
    } catch (error) {
        return {
            success: false,
            file: file.sourcePath,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
async function main() {
    const data = workerData;
    if (!parentPort) {
        throw new Error("This script must be run as a worker thread");
    }
    for (const file of data.files){
        const result = await copyFile(file);
        parentPort.postMessage(result);
    }
}
main().catch((error)=>{
    if (parentPort) {
        parentPort.postMessage({
            success: false,
            file: 'worker',
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

//# sourceMappingURL=copy-worker.js.map