var doc = document;

// Function to set the navigation path
function getPath() {
    const raw_path = window.location.pathname;
    const path = raw_path.split('/');
    if (raw_path != '/' && raw_path != '/tsioftolithomata/') {
        const file = path.pop();
        console.assert(file.endsWith(".html"), `Path (${path}) should be to .html file`);
    } else {
        path.pop(); // Remove the last element which is an empty string / not needed
    }
    return path.filter((item) => item != 'tree' && item != 'tsioftolithomata').map((item, index) => {
        if (item == '') {
            return {
                name: "home",
                link: '/index.html'
            }
        }
        else {
            return {
                name: item,
                link: path.slice(0, index + 1).join('/') + '/' + item + '/' + item + '.html'
            }
        }
    });
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

const path = getPath();
const navPathLoadedEvt = new Event("navPathLoaded");

window.addEventListener('headerLoaded', () => {
    const pathElement = doc.getElementById('navpath');
    pathElement.path = path;
    window.dispatchEvent(navPathLoadedEvt);
})
