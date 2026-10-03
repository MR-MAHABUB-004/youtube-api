const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();

const BASE_URL = 'https://ytdl.lol';

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36',
  'sec-ch-ua':
    '"Android WebView";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  Accept: '*/*',
  Origin: BASE_URL,
  'X-Requested-With': 'mark.via.gp',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: `${BASE_URL}/`,
  'Accept-Language': 'en-US,en;q=0.9'
};

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function getFreshSession() {
  const response = await axios.get(BASE_URL, {
    headers: BASE_HEADERS,
    timeout: 15000
  });

  const setCookies = response.headers['set-cookie'] || [];

  let csrfToken = null;
  const cookies = [];

  for (const cookie of setCookies) {
    const keyValue = cookie.split(';')[0];

    if (keyValue) {
      cookies.push(keyValue);
    }

    if (keyValue.startsWith('csrftoken=')) {
      csrfToken = keyValue.substring('csrftoken='.length);
    }
  }

  // Fallback: search CSRF token inside HTML
  if (!csrfToken && typeof response.data === 'string') {
    const match = response.data.match(
      /name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/
    );

    if (match) {
      csrfToken = match[1];
    }
  }

  if (!csrfToken) {
    throw new Error('Could not extract CSRF token.');
  }

  return {
    csrfToken,
    cookieString: cookies.join('; ')
  };
}

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'YouTube Downloader API',
    endpoint: '/api/dl',
    usage: '/api/dl?url=YOUTUBE_URL&format=mp4'
  });
});

app.get('/api/dl', async (req, res) => {
  const ytUrl = req.query.url;
  const format = String(req.query.format || 'mp4').toLowerCase();

  if (!ytUrl) {
    return res.status(400).json({
      status: 'error',
      error: "Missing 'url' query parameter.",
      example: '/api/dl?url=https://youtube.com/watch?v=VIDEO_ID&format=mp4'
    });
  }

  if (!['mp3', 'mp4'].includes(format)) {
    return res.status(400).json({
      status: 'error',
      error: "Invalid format. Use 'mp3' or 'mp4'."
    });
  }

  try {
    // ==============================
    // STEP 1: Fresh session
    // ==============================

    const {
      csrfToken,
      cookieString
    } = await getFreshSession();

    // ==============================
    // STEP 2: Initiate download
    // ==============================

    const form = new FormData();

    form.append('csrfmiddlewaretoken', csrfToken);
    form.append('yt_link', ytUrl);
    form.append('theme_val', '0');
    form.append('video_quality', 'medium');
    form.append('audio_quality', 'medium');

    form.append(
      'action',
      format === 'mp3' ? 'audio' : 'video'
    );

    const initHeaders = {
      ...BASE_HEADERS,
      ...form.getHeaders(),
      'X-CSRFToken': csrfToken,
      Cookie: cookieString
    };

    const initResponse = await axios.post(
      `${BASE_URL}/initiate_download/`,
      form,
      {
        headers: initHeaders,
        timeout: 30000,
        maxBodyLength: Infinity
      }
    );

    const taskId = initResponse.data?.task_id;

    if (!taskId) {
      throw new Error(
        `Failed to get task_id: ${JSON.stringify(initResponse.data)}`
      );
    }

    // ==============================
    // STEP 3: Poll task status
    // ==============================

    const statusUrl =
      `${BASE_URL}/task_status/${taskId}/`;

    const statusHeaders = {
      ...BASE_HEADERS,
      Cookie: cookieString
    };

    const maxRetries = 60;

    for (let i = 0; i < maxRetries; i++) {
      const statusResponse = await axios.get(
        statusUrl,
        {
          headers: statusHeaders,
          timeout: 15000
        }
      );

      const statusData = statusResponse.data;

      if (statusData.state === 'SUCCESS') {
        return res.json({
          status: 'success',
          task_id: taskId,
          format,
          metadata: statusData.result,

          // Actual download URL
          download:
            `${BASE_URL}/download_ready/${taskId}/`
        });
      }

      if (statusData.state === 'FAILURE') {
        throw new Error(
          'Download task failed on the remote server.'
        );
      }

      await sleep(2000);
    }

    throw new Error(
      'Timeout: Video processing took too long.'
    );

  } catch (error) {
    console.error(
      'Download API Error:',
      error.response?.data || error.message
    );

    return res.status(500).json({
      status: 'error',
      error:
        error.response?.data ||
        error.message ||
        'Internal Server Error'
    });
  }
});

// IMPORTANT:
// Do NOT use app.listen() on Vercel.
module.exports = app;
