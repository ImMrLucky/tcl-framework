// Netlify serverless function to proxy API requests to TCL Core
exports.handler = async (event, context) => {
  const TCL_CORE_URL = process.env.NETLIFY_TCL_CORE_URL;
  
  if (!TCL_CORE_URL) {
    console.error('NETLIFY_TCL_CORE_URL environment variable is not set');
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Server configuration error: NETLIFY_TCL_CORE_URL not set' 
      }),
    };
  }
  
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: '',
    };
  }
  
  // Extract the path from the original request
  // Netlify redirects /api/* to /.netlify/functions/proxy?path=:splat
  // :splat captures everything after /api/, so for /api/issues-v2, :splat = issues-v2
  let apiPath = null;
  
  // Method 1: Check query parameters first (most reliable for Netlify redirects)
  // The redirect passes :splat as the path query parameter
  if (event.queryStringParameters?.path) {
    apiPath = event.queryStringParameters.path;
    // :splat doesn't include leading /, so add it if needed
    if (!apiPath.startsWith('/')) {
      apiPath = '/' + apiPath;
    }
  }
  
  // Method 2: Check X-Original-URL header (set by Netlify redirects)
  if (!apiPath) {
    const originalUrl = event.headers['x-original-url'] || event.headers['X-Original-URL'];
    if (originalUrl) {
      try {
        const url = new URL(originalUrl);
        // Extract path after /api
        const match = url.pathname.match(/^\/api(\/.*)$/);
        if (match) {
          apiPath = match[1];
        }
      } catch (e) {
        console.error('Error parsing original URL:', e);
      }
    }
  }
  
  // Method 3: Check rawUrl
  if (!apiPath && event.rawUrl) {
    try {
      const url = new URL(event.rawUrl);
      const match = url.pathname.match(/^\/api(\/.*)$/);
      if (match) {
        apiPath = match[1];
      }
    } catch (e) {
      // rawUrl might not be a full URL, try parsing as path
      const match = event.rawUrl.match(/^\/api(\/.*)$/);
      if (match) {
        apiPath = match[1];
      }
    }
  }
  
  // Method 4: Check path from event.path (if available)
  if (!apiPath && event.path) {
    const match = event.path.match(/^\/api(\/.*)$/);
    if (match) {
      apiPath = match[1];
    }
  }
  
  // Fallback: default to /validate if no path found
  if (!apiPath) {
    console.warn('Could not extract path from request, defaulting to /validate');
    console.log('Event:', JSON.stringify({
      queryStringParameters: event.queryStringParameters,
      headers: Object.keys(event.headers),
      path: event.path,
      rawUrl: event.rawUrl
    }, null, 2));
    apiPath = '/validate';
  }
  
  // Ensure path starts with /
  if (!apiPath.startsWith('/')) {
    apiPath = '/' + apiPath;
  }
  
  // Reconstruct full API path: /api + apiPath
  // For example: /api + /issues-v2 = /api/issues-v2
  const fullPath = '/api' + apiPath;
  
  // Preserve query string from original request
  let queryString = '';
  if (event.queryStringParameters) {
    // Filter out the 'path' parameter we used for routing
    const queryParams = { ...event.queryStringParameters };
    delete queryParams.path;
    const queryEntries = Object.entries(queryParams).filter(([_, v]) => v !== null && v !== undefined);
    if (queryEntries.length > 0) {
      queryString = '?' + queryEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    }
  }
  
  const url = `${TCL_CORE_URL}${fullPath}${queryString}`;
  
  console.log(`Proxying ${event.httpMethod} ${fullPath}${queryString} to ${url}`);
  
  try {
    // Forward the request to TCL Core
    const headers = {};
    
    // Forward all relevant headers from the original request
    // Netlify lowercases all header names, so check both cases
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const isMultipart = contentType && contentType.includes('multipart/form-data');
    
    // Forward authorization header (Netlify lowercases all headers)
    // Check both lowercase and original case
    const authHeader = event.headers.authorization || event.headers['Authorization'] || event.headers['authorization'];
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    
    // Also forward any other headers that might be needed
    // Netlify lowercases all header names, so we need to check lowercase versions
    for (const [key, value] of Object.entries(event.headers)) {
      const lowerKey = key.toLowerCase();
      // Skip headers we've already handled or that Netlify manages
      if (lowerKey !== 'content-type' && lowerKey !== 'authorization' && 
          lowerKey !== 'host' && lowerKey !== 'content-length' &&
          !lowerKey.startsWith('x-') && !lowerKey.startsWith('netlify-')) {
        headers[key] = value;
      }
    }
    
    // Handle body based on content type
    let body = event.body;
    
    if (body) {
      if (isMultipart) {
        // For multipart/form-data, preserve the original Content-Type with boundary
        // This is critical for multer to parse the multipart data correctly
        if (contentType) {
          headers['Content-Type'] = contentType;
        }
        
        // Netlify provides multipart body as base64-encoded string or raw string
        // Convert to Buffer for fetch
        if (event.isBase64Encoded) {
          body = Buffer.from(body, 'base64');
        } else if (typeof body === 'string') {
          body = Buffer.from(body, 'utf8');
        }
      } else {
        // For JSON, set Content-Type and ensure body is a string
        if (contentType) {
          headers['Content-Type'] = contentType;
        }
        if (typeof body !== 'string') {
          body = JSON.stringify(body);
        }
      }
    }
    
    const response = await fetch(url, {
      method: event.httpMethod,
      headers: headers,
      body: body || undefined,
    });
    
    const data = await response.text();
    
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: data,
    };
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: error.message || 'Proxy error' }),
    };
  }
};
