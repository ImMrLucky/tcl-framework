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
    if (contentType && !contentType.includes('multipart/form-data')) {
      // Only set Content-Type if it's not multipart/form-data
      // For multipart, let fetch set it automatically with the boundary
      headers['Content-Type'] = contentType;
    }
    
    // Forward authorization header (Netlify lowercases headers)
    const authHeader = event.headers.authorization || event.headers['Authorization'];
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    
    // Handle body based on content type
    let body = event.body;
    const isMultipart = contentType && contentType.includes('multipart/form-data');
    
    if (body) {
      if (isMultipart) {
        // For multipart/form-data, Netlify provides body as base64-encoded string
        // We need to convert it to a Buffer for fetch
        if (event.isBase64Encoded) {
          body = Buffer.from(body, 'base64');
        } else if (typeof body === 'string') {
          body = Buffer.from(body, 'utf8');
        }
        // Don't set Content-Type for multipart - fetch will set it with boundary
        delete headers['Content-Type'];
      } else {
        // For JSON, ensure it's a string
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
