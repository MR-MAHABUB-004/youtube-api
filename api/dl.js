const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = "https://ytdl.lol";

const BASE_HEADERS = {
  "Host": "ytdl.lol",
  "Connection": "keep-alive",
  "sec-ch-ua-platform": "\"Android\"",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36",
  "sec-ch-ua": "\"Android WebView\";v=\"153\", \"Not_A Brand\";v=\"8\", \"Chromium\";v=\"153\"",
  "sec-ch-ua-mobile": "?1",
  "Accept": "*/*",
  "Origin": "https://ytdl.lol",
  "X-Requested-With": "mark.via.gp",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Referer": "https://ytdl.lol/",
  "Accept-Language": "en-US,en;q=0.9"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getFreshSession() {
  const homeRes = await axios.get(BASE_URL, { headers: BASE_HEADERS });
  const setCookies = homeRes.headers['set-cookie'] || [];
  
  let csrfToken = null;
  let cookiesArray = [];

  for (const cookie of setCookies) {
    const keyValue = cookie.split(';')[0]; 
    cookiesArray.push(keyValue);
    if (keyValue.startsWith('csrftoken=')) {
      csrfToken = keyValue.split('=')[1];
    }
  }

  if (!csrfToken && homeRes.data) {
    const match = homeRes.data.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
    if (match) csrfToken = match[1];
  }

  if (!csrfToken) throw new Error("Could not extract a fresh CSRF token.");

  return { csrfToken, cookieString: cookiesArray.join('; ') };
}

// Vercel Serverless Function Export
module.exports = async (req, res) => {
  // শুধুমাত্র GET মেথড অনুমতি দেওয়া হলো
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ytUrl = req.query.url;
  const format = (req.query.format || 'mp4').toLowerCase();

  if (!ytUrl) {
    return res.status(400).json({ error: "Missing 'url' query parameter. Use ?url=<YT_URL>" });
  }

  if (format !== 'mp3' && format !== 'mp4') {
    return res.status(400).json({ error: "Invalid 'format'. Use 'mp3' or 'mp4'." });
  }

  try {
    const { csrfToken, cookieString } = await getFreshSession();

    const form = new FormData();
    form.append('csrfmiddlewaretoken', csrfToken);
    form.append('yt_link', ytUrl);
    form.append('theme_val', '0');
    form.append('video_quality', 'medium');
    form.append('audio_quality', 'medium');
    
    const actionType = format === 'mp3' ? 'audio' : 'video';
    form.append('action', actionType);

    const initHeaders = {
      ...BASE_HEADERS,
      "X-CSRFToken": csrfToken,
      "Cookie": cookieString,
      ...form.getHeaders() 
    };

    const initResponse = await axios.post(`${BASE_URL}/initiate_download/`, form, { headers: initHeaders });
    const taskId = initResponse.data?.task_id;
    
    if (!taskId) {
      throw new Error(`Failed to get task_id. Response: ${JSON.stringify(initResponse.data)}`);
    }

    const statusUrl = `${BASE_URL}/task_status/${taskId}/`;
    const statusHeaders = { ...BASE_HEADERS, "Cookie": cookieString };
    const maxRetries = 60; 

    for (let i = 0; i < maxRetries; i++) {
      const statusResponse = await axios.get(statusUrl, { headers: statusHeaders });
      const statusData = statusResponse.data;

      if (statusData.state === "SUCCESS") {
        return res.status(200).json({
          status: "success",
          task_id: taskId,
          format: format,
          metadata: statusData.result,
          download: `${BASE_URL}/download_ready/${taskId}/`,
          download_url_hint: `${BASE_URL}/download/${taskId}/` 
        });
      } else if (statusData.state === "FAILURE") {
        throw new Error("Download task failed on the remote server.");
      }

      await sleep(2000);
    }

    throw new Error("Timeout: Video processing took too long.");

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};
