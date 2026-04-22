chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (!tab.id) throw new Error("No tab ID");

        if (tab.url.startsWith("chrome://") || tab.url.startsWith("brave://")) {
            return;
        }

        // Ensure content script
        let isLoaded = false;
        try {
            await chrome.tabs.sendMessage(tab.id, { type: "PING" });
            isLoaded = true;
        } catch (e) {}

        if (!isLoaded) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            });
        }

        const steps = [
            "Extracting data",
            "Formatting with AI",
            "Creating GitLab issue"
        ];

        // INIT UI
        chrome.tabs.sendMessage(tab.id, {
            type: "INIT_STEPS",
            payload: steps
        });

        // STEP 1
        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[0], status: "active" }
        });

        await sleep(1000);

        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[0], status: "done" }
        });

        // STEP 2
        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[1], status: "active" }
        });

        await sleep(1500);

        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[1], status: "done" }
        });

        // STEP 3
        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[2], status: "active" }
        });

        await sleep(1000);

        chrome.tabs.sendMessage(tab.id, {
            type: "STEP_UPDATE",
            payload: { step: steps[2], status: "done" }
        });

        // FINAL RESULT
        const resultText = "RESULT_" + Math.random().toString(36).substring(7);

        chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_RESULT",
            payload: resultText
        });

    } catch (err) {
        console.error(err);
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
