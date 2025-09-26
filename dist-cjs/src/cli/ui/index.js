export { CompatibleUI, createCompatibleUI, isRawModeSupported, launchUI } from './compatible-ui.js';
export { handleRawModeError, withRawModeFallback, checkUISupport, showUISupport } from './fallback-handler.js';
export async function launchBestUI() {
    const fallbackHandler = await import('./fallback-handler.js');
    const { checkUISupport, handleRawModeError } = fallbackHandler;
    const launchUI = fallbackHandler.launchUI;
    const support = checkUISupport();
    if (support.supported) {
        try {
            await launchUI();
        } catch (error) {
            if (error instanceof Error) {
                await handleRawModeError(error, {
                    enableUI: true,
                    fallbackMessage: 'Falling back to compatible UI mode',
                    showHelp: true
                });
            }
        }
    } else {
        const { launchUI: launchCompatibleUI } = await import('./compatible-ui.js');
        console.log('🔄 Using compatible UI mode for this environment');
        await launchCompatibleUI();
    }
}

//# sourceMappingURL=index.js.map