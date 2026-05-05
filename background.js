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
        const extractedData = {
            title: "Test title",
            url: tab.url,
            content: "User reported something is broken"
        };
        await sleep(500);
        await updateStep(tab.id, steps[0], "done");

        // -------------------------
        // STEP 2 — AI Formatting
        // -------------------------
        await updateStep(tab.id, steps[1], "active");
        const aiDescription = await formatWithGemini(extractedData);
        await updateStep(tab.id, steps[1], "done");

        // -------------------------
        // STEP 3 — GitLab
        // -------------------------
        await updateStep(tab.id, steps[2], "active");

        const issue = await createGitlabIssue({
            title: extractedData.title,
            description: aiDescription
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
    const {
        gitlabToken,
        projectId,
        baseUrl,
        userId,
        milestoneId,
        labels,
        severity,
        estimateHours
    } = await getConfig();

    const dueDate = new Date().toISOString().split("T")[0];

    const allLabels = [...labels, severity].join(",");

    const response = await fetch(`${baseUrl}/projects/${projectId}/issues`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "PRIVATE-TOKEN": gitlabToken
        },
        body: JSON.stringify({
            title,
            description,
            assignee_ids: [userId],
            milestone_id: milestoneId,
            labels: allLabels,
            due_date: dueDate,
            time_estimate: estimateHours * 3600
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

async function formatWithGemini({ title, url, content }) {
    const { GEMINI_API_KEY } = await getConfig();

    const prompt = `
You are a system that generates GitLab issues.

Follow this EXACT structure:

## Context
...

## Description
...

## Steps to reproduce
...

## Expected behavior
...

## Actual behavior
...

Rules:
- Return ONLY the formatted issue
- Do NOT add explanations
- Do NOT skip sections
- Use "N/A" if missing

DATA:
Title: ${title}
URL: ${url}
Content: ${content}
`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ]
            })
        }
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error("Gemini error: " + err);
    }

    const data = await response.json();

    console.log("Gemini raw:", data);

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "N/A";
}