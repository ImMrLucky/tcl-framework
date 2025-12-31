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
  // Netlify sets headers with the original request info
  let path = '/validate'; // default
  
  // Method 1: Check X-Original-URL header (set by Netlify redirects)
  const originalUrl = event.headers['x-original-url'] || event.headers['X-Original-URL'];
  if (originalUrl) {
    try {
      const url = new URL(originalUrl);
      const match = url.pathname.match(/^\/api(\/.*)$/);
      if (match) {
        path = match[1];
      }
    } catch (e) {
      console.error('Error parsing original URL:', e);
    }
  }
  
  // Method 2: Check rawUrl
  if (path === '/validate' && event.rawUrl) {
    try {
      const url = new URL(event.rawUrl);
      const match = url.pathname.match(/^\/api(\/.*)$/);
      if (match) {
        path = match[1];
      }
    } catch (e) {
      // rawUrl might not be a full URL
    }
  }
  
  // Method 3: Check query parameters (if redirect passes it)
  if (path === '/validate' && event.queryStringParameters?.path) {
    path = event.queryStringParameters.path.startsWith('/') 
      ? event.queryStringParameters.path 
      : '/' + event.queryStringParameters.path;
  }
  
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  const url = `${TCL_CORE_URL}${path}`;
  
  try {
    // Forward the request to TCL Core
    const headers = {};
    
    // Forward all relevant headers from the original request
    // Netlify lowercases all header names, so check both cases
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const isMultipart = contentType && contentType.includes('multipart/form-data');
    
    // Forward authorization header (Netlify lowercases headers)
    const authHeader = event.headers.authorization || event.headers['Authorization'];
    if (authHeader) {
      headers['Authorization'] = authHeader;
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
