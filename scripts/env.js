const get_env = () => {
    return window.location.hostname === 'localhost' ? 'dev' : 'prod';
}

const getBaseURL = () => {
    return get_env() === 'dev' ? 'http://localhost:8000' : 'https://tsioftas.github.io/tsioftolithomata';
}

function getRelativePath(absolutePath) {
    const currentPath = window.location.pathname;
    const pathSegments = currentPath.split('/').filter(segment => segment); // Split and remove empty segments
  
    let dots = '';
  
    // Determine how many levels to go up
    for (let i = 0; i < pathSegments.length - 1; i++) {
        dots += '../';
    }
  
    return dots + absolutePath;
}