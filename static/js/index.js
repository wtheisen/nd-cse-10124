function toggleResources(id, unit) {
    const button = document.getElementById(id);
    const resourcesRow = document.getElementById(`resources-${id}`);
    const unitCell = document.getElementById(`unit-cell-${unit}`);

    if (resourcesRow.style.display === 'table-row') {
        button.classList.remove('fa-caret-down');
        button.classList.add('fa-caret-right');

        if (unitCell) { unitCell.rowSpan = unitCell.rowSpan - 1; }
        resourcesRow.style.display = 'none';
    } else {
        button.classList.remove('fa-caret-right');
        button.classList.add('fa-caret-down');

        if (unitCell) { unitCell.rowSpan = unitCell.rowSpan + 1; }
        resourcesRow.style.display = 'table-row';
    }
}

function getTopicRowColors() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'gruvbox-dark') {
        return ['#3a3432', '#2e2a28'];
    }
    // Light theme (bluegold) uses neutral gray/white striping
    return ['#f9f9f9', '#ffffff'];
}

function fixAlternatingRows() {
    let topicRows = document.querySelectorAll(".topic-row");
    const [evenColor, oddColor] = getTopicRowColors();
    let altIndex = 0;
    topicRows.forEach(row => {
        if (row.querySelector('td[colspan="4"]')) {
            row.style.backgroundColor = '';
            return;
        }
        row.style.backgroundColor = altIndex % 2 === 0 ? evenColor : oddColor;
        altIndex += 1;
    });
}

document.querySelectorAll(".caret-icon").forEach(icon => {
    icon.addEventListener("click", function() {
        setTimeout(fixAlternatingRows, 200);
    });
});

document.addEventListener("themechange", fixAlternatingRows);
document.addEventListener("DOMContentLoaded", fixAlternatingRows);

function toggleResourceSection(id) {
    const resourcesDiv = document.getElementById(id);
    const icon = document.getElementById(`${id}-icon`);

    if (resourcesDiv.style.display === 'none' || resourcesDiv.style.display === '') {
        resourcesDiv.style.display = 'block';
        icon.classList.remove('fa-caret-right');
        icon.classList.add('fa-caret-down');
    } else {
        resourcesDiv.style.display = 'none';
        icon.classList.remove('fa-caret-down');
        icon.classList.add('fa-caret-right');
    }
}
