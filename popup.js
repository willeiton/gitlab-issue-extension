document.getElementById('extract').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            return {
                title: document.title,
                url: window.location.href,
                selection: window.getSelection().toString()
            };
        }
    });

    const data = result[0].result;

    document.getElementById('output').textContent =
        JSON.stringify(data, null, 2);
});
