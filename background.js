import { getConfig } from "./config.js";

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

        // INIT
        chrome.tabs.sendMessage(tab.id, {
            type: "INIT_STEPS",
            payload: steps
        });

        // -------------------------
        // STEP 1 — Extracting
        // -------------------------
        await updateStep(tab.id, steps[0], "active");

        // (fake for now)
        await sleep(500);

        await updateStep(tab.id, steps[0], "done");

        // -------------------------
        // STEP 2 — AI Formatting
        // -------------------------
        await updateStep(tab.id, steps[1], "active");

        // (fake for now)
        await sleep(700);

        await updateStep(tab.id, steps[1], "done");

        // -------------------------
        // STEP 3 — GitLab
        // -------------------------
        await updateStep(tab.id, steps[2], "active");

        const issue = await createGitlabIssue({
            title: "Test issue from extension",
            description: "This is a test issue created from my extension 🚀"
        });

        await updateStep(tab.id, steps[2], "done");

        // FINAL RESULT
        chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_RESULT",
            payload: `Issue created: ${issue.web_url}`
        });

    } catch (err) {
        console.error(err);

        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: "SHOW_RESULT",
                payload: "❌ Error creating issue"
            });
        }
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function createGitlabIssue({ title, description }) {
    const { gitlabToken, projectId, baseUrl } = await getConfig();

    const response = await fetch(`${baseUrl}/projects/${projectId}/issues`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "PRIVATE-TOKEN": gitlabToken
        },
        body: JSON.stringify({
            title,
            description
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitLab API error: ${errorText}`);
    }

    return await response.json();
}

async function updateStep(tabId, step, status) {
    chrome.tabs.sendMessage(tabId, {
        type: "STEP_UPDATE",
        payload: { step, status }
    });
}