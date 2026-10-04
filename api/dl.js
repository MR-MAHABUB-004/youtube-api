// api/index.js

export default async function handler(req, res) {
  // Allow GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get the video ID from the query parameters
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing "id" query parameter' });
  }

  try {
    // 1. Fetch data from the upstream API
    const upstreamUrl = `https://api.vidsnap.app/parse?id=${id}`;
    const response = await fetch(upstreamUrl);
    
    if (!response.ok) {
      throw new Error(`Upstream API responded with status: ${response.status}`);
    }
    
    const data = await response.json();

    // 2. Transform the response
    const transformedResponse = {
      title: data.title,
      thumbnails: data.thumbnails,
      formats: data.formats.map(format => {
        // Wrap the original URL in the proxy URL
        const proxiedUrl = `https://api.vidsnap.app/proxy?u=${encodeURIComponent(format.url)}`;
        
        return {
          ...format,
          url: proxiedUrl
        };
      })
    };

    // 3. Return the modified JSON
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(transformedResponse);

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process request', 
      details: error.message 
    });
  }
}
