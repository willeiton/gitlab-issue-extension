import { ENV } from "./env.js";

export async function getConfig() {
    return {
        gitlabToken: ENV.GITLAB_TOKEN,
        projectId: ENV.GITLAB_PROJECT_ID,
        baseUrl: ENV.GITLAB_BASE_URL,
        GEMINI_API_KEY: ENV.GEMINI_API_KEY
    };
}