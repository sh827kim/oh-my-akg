const fs = require('fs');
const path = require('path');

function getFiles(dir, filesList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.next') {
                getFiles(fullPath, filesList);
            }
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            filesList.push(fullPath);
        }
    }
    return filesList;
}

const allFiles = getFiles('/Users/spark/workspace/oh-my-akg/apps/web');

allFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    content = content.replace(/getProjectTypeFromMetadata/g, 'getServiceTypeFromMetadata');
    content = content.replace(/getProjectStatusFromMetadata/g, 'getObjectStatusFromMetadata');
    content = content.replace(/projectType/g, 'serviceType');
    content = content.replace(/ProjectType/g, 'ServiceType');
    content = content.replace(/initialProjects/g, 'initialServices');

    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log('Fixed types in', file);
    }
});
