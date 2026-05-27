// Function to construct the navigation path from window.location.pathname
function getPath() {
  const offset = 2; // how many elements to skip in the path
  const raw_path = window.location.pathname;
  const path = raw_path.split('/');
  if (raw_path != '/' && raw_path != '/tsioftolithomata/') {
    const file = path.pop();
    console.assert(file.endsWith(".html"), `Path (${path}) should be to .html file`);
  } else {
    path.pop(); // Remove the last element which is an empty string / not needed
  }
  return path.filter((item) => item != '' && item != 'tree' && item != 'tsioftolithomata').map((item, index) => {
    return {
      name: item,
      link: path.slice(0, index + offset).join('/') + '/' + item + '/' + item + '.html'
    };
  });
}

fetch(getBaseURL() + '/templates/header.html')
  .then(response => response.text())
  .then(data => {
    waitForCondition(
      () => document.getElementById('header-container'),
      () => {
        document.getElementById('header-container').innerHTML = data;
        document.getElementById("home-btn").href = getBaseURL();
        document.getElementById("map-btn").href = getBaseURL() + "/map.html";
        document.getElementById("journal-btn").href = getBaseURL() + "/journal/index.html";
        document.getElementById("quiz-btn").href = getBaseURL() + "/quiz.html";

        const pathElement = document.getElementById('navpath');
        const pathParts = window.location.pathname.split('/');
        if (!pathParts.includes('tree')) {
          if (pathElement) {
            pathElement.style.display = "none";
          }
        } else {
          navPath = getPath();
          if (navPath.length > 0) {
            pathElement.style.display = "flex";
          }
        }
      }
    );
  });
