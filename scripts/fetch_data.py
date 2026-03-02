#!/usr/bin/env python3
"""
Fetch and sync data from external platforms (GitHub, ORCID)
This script updates the website content automatically and generates blog posts
for new repositories, repository updates, and new publications.
"""

import json
import os
import re
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import TypedDict

# Configuration
GITHUB_USERNAME = "CGutt-hub"
ORCID_ID = "0000-0002-1774-532X"
WEBSITE_REPO = "5ha99y"  # This repo name for tracking website changes


class GitHubRepo(TypedDict):
    name: str
    description: str
    readme: str
    url: str
    language: str | None
    stars: int
    updated: str
    pushed_at: str
    commits_url: str


class OrcidWork(TypedDict):
    title: str
    year: str | None
    type: str | None


class OSFProject(TypedDict):
    title: str
    description: str
    url: str
    created: str


class RepoTrackingInfo(TypedDict):
    last_pushed: str  # ISO timestamp of last push
    last_posted: str  # YYYY-MM-DD of last blog post


class TrackedState(TypedDict):
    repos: dict[str, RepoTrackingInfo]  # repo_name -> tracking info
    publications: list[str]  # list of publication titles
    website: RepoTrackingInfo  # website repo tracking info


class PlotData(TypedDict):
    repo_name: str
    file_path: str
    plot_data: dict  # The actual plot JSON
    updated: str
    repo_url: str


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug"""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    return text.strip('-')

def sanitize_markdown(text: str) -> str:
    """Sanitize markdown content to prevent Zola build errors.
    Fixes empty links like [text]() that cause 'missing URL' errors."""
    # Replace nested badge links with empty outer URL: [![alt](img)]() -> ![alt](img)
    text = re.sub(r'\[!\[([^\]]*)\]\(([^)]+)\)\]\(\s*\)', r'![\1](\2)', text)
    # Replace simple links with empty URLs: [text]() -> text
    text = re.sub(r'\[([^\]]*)\]\(\s*\)', r'\1', text)
    return text

def fetch_github_repos() -> list[GitHubRepo]:
    """Fetch public repositories from GitHub with README content"""
    url = f"https://api.github.com/users/{GITHUB_USERNAME}/repos"
    headers = {}
    # Use GitHub token if available for higher rate limits
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = f"token {os.environ['GITHUB_TOKEN']}"
    
    try:
        response = requests.get(url, params={"sort": "updated", "per_page": 20}, headers=headers)
        response.raise_for_status()
        repos = response.json()
        
        # Filter out forks and sort by stars/updates
        repos = [r for r in repos if not r['fork']]
        repos.sort(key=lambda x: (x['stargazers_count'], x['updated_at']), reverse=True)
        
        result: list[GitHubRepo] = []
        for repo in repos[:10]:  # Top 10 repos
            # Fetch README content
            readme_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo['name']}/readme"
            readme_content = "No README available."
            try:
                readme_response = requests.get(readme_url, headers={**headers, 'Accept': 'application/vnd.github.v3.raw'})
                if readme_response.status_code == 200:
                    readme_content = sanitize_markdown(readme_response.text.strip())
            except:
                pass
            
            result.append({
                'name': repo['name'],
                'description': repo['description'] or 'No description',
                'readme': readme_content,
                'url': repo['html_url'],
                'language': repo['language'],
                'stars': repo['stargazers_count'],
                'updated': repo['updated_at'],
                'pushed_at': repo['pushed_at'],
                'commits_url': repo['commits_url'].replace('{/sha}', '')
            })
        
        return result
    except Exception as e:
        print(f"Error fetching GitHub repos: {e}")
        return []


def fetch_recent_commits(repo_name: str, since: str | None = None) -> list[dict]:
    """Fetch recent commits for a repository"""
    url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/commits"
    headers = {}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = f"token {os.environ['GITHUB_TOKEN']}"
    
    params = {"per_page": 5}
    if since:
        params['since'] = since
    
    try:
        response = requests.get(url, params=params, headers=headers)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching commits for {repo_name}: {e}")
        return []

def fetch_orcid_works() -> list[OrcidWork]:
    """Fetch works/publications from ORCID"""
    url = f"https://pub.orcid.org/v3.0/{ORCID_ID}/works"
    headers = {'Accept': 'application/json'}
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        works: list[OrcidWork] = []
        for group in data.get('group', [])[:10]:  # Latest 10
            work_summary = group.get('work-summary', [{}])[0]
            title = work_summary.get('title', {})
            works.append({
                'title': title.get('title', {}).get('value', 'Untitled'),
                'year': work_summary.get('publication-date', {}).get('year', {}).get('value'),
                'type': work_summary.get('type')
            })
        
        return works
    except Exception as e:
        print(f"Error fetching ORCID works: {e}")
        return []

def fetch_osf_projects() -> list[OSFProject]:
    """Fetch projects from OSF"""
    osf_user_id = "k7zrs"  # Your OSF user ID
    url = f"https://api.osf.io/v2/users/{osf_user_id}/nodes/"
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        projects: list[OSFProject] = []
        for node in data.get('data', [])[:10]:  # Latest 10 projects
            attrs = node.get('attributes', {})
            projects.append({
                'title': attrs.get('title', 'Untitled'),
                'description': attrs.get('description', ''),
                'url': attrs.get('html_url', ''),
                'created': attrs.get('date_created', '')
            })
        
        return projects
    except Exception as e:
        print(f"Error fetching OSF projects: {e}")
        return []


def search_repo_for_plots(repo_name: str, repo_url: str, updated: str) -> list[PlotData]:
    """Search a repository for plot JSON files"""
    headers = {}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = f"token {os.environ['GITHUB_TOKEN']}"
    
    # Search for files with .json extension in common plot directories
    search_paths = [
        'plots', 'figures', 'results', 'output', 'visualizations', 'analysis',
        'data/plots', 'data/figures', ''  # '' searches root
    ]
    
    plot_files: list[PlotData] = []
    
    for search_path in search_paths:
        try:
            # Get contents of directory
            url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/{search_path}"
            response = requests.get(url, headers=headers)
            
            if response.status_code != 200:
                continue
            
            contents = response.json()
            if not isinstance(contents, list):
                continue
            
            # Look for .json files that might be plots
            for item in contents:
                if item['type'] == 'file' and item['name'].endswith('.json'):
                    # Check if it might be a plot file (common naming patterns)
                    name_lower = item['name'].lower()
                    if any(keyword in name_lower for keyword in ['plot', 'figure', 'chart', 'graph', 'viz', 'visual']):
                        # Fetch the actual JSON content
                        try:
                            json_response = requests.get(item['download_url'], headers=headers)
                            if json_response.status_code == 200:
                                plot_json = json_response.json()
                                
                                plot_files.append({
                                    'repo_name': repo_name,
                                    'file_path': f"{search_path}/{item['name']}" if search_path else item['name'],
                                    'plot_data': plot_json,
                                    'updated': updated,
                                    'repo_url': repo_url
                                })
                                print(f"  Found plot: {repo_name}/{search_path}/{item['name']}" if search_path else f"  Found plot: {repo_name}/{item['name']}")
                        except Exception as e:
                            print(f"  Error fetching plot JSON from {item['name']}: {e}")
        except Exception as e:
            # Directory doesn't exist or other error, continue
            continue
    
    return plot_files


def fetch_all_research_plots() -> list[PlotData]:
    """Fetch all plot JSON files from all repositories"""
    print("[*] Searching repositories for plot JSONs...")
    
    headers = {}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = f"token {os.environ['GITHUB_TOKEN']}"
    
    # Get all repos
    url = f"https://api.github.com/users/{GITHUB_USERNAME}/repos"
    try:
        response = requests.get(url, params={"sort": "updated", "per_page": 50}, headers=headers)
        response.raise_for_status()
        repos = response.json()
        
        # Filter out forks and website repo
        repos = [r for r in repos if not r['fork'] and r['name'] != WEBSITE_REPO]
        
        all_plots: list[PlotData] = []
        
        for repo in repos:
            print(f"[*] Scanning {repo['name']}...")
            plots = search_repo_for_plots(
                repo_name=repo['name'],
                repo_url=repo['html_url'],
                updated=repo['updated_at']
            )
            all_plots.extend(plots)
        
        print(f"[+] Found {len(all_plots)} plot files across {len(repos)} repositories")
        return all_plots
        
    except Exception as e:
        print(f"Error fetching repositories for plots: {e}")
        return []

def generate_projects_page(github_repos: list[GitHubRepo]) -> str:
    """Generate projects page from GitHub data with collapsible sections"""
    content = """+++
title = "Code Projects & Repositories"
+++

*Active development projects tracked via [GitHub](https://github.com/CGutt-hub). My open backoffice for collaborative science.*

---

"""
    
    if not github_repos:
        content += "*No repositories found.*\n"
    else:
        for repo in github_repos:
            stars = f" ⭐ {repo['stars']}" if repo['stars'] > 0 else ""
            lang = repo['language'] or "Unknown"
            content += f"""### {repo['name']}

**Language:** {lang}{stars}  
**Last updated:** {repo['updated'][:10]}

<details>
<summary>View README</summary>

{repo['readme']}

</details>

[View on GitHub →]({repo['url']})

---

"""
    
    content += """
## Development Philosophy

All code is developed with a commitment to **open and transparent science**. Tools, pipelines, and analysis code are made available to support reproducibility and collaborative advancement of knowledge.
"""
    
    return content

def generate_publications_page(orcid_works: list[OrcidWork]) -> str:
    """Generate publications page from ORCID data (complete research output)"""
    content = """+++
title = "Research Publications"
+++

*Complete research output tracked via [ORCID](https://orcid.org/0000-0002-1774-532X). My open front office for formal research.*

---

"""
    
    if orcid_works:
        for work in orcid_works:
            year = work.get('year') or 'n.d.'
            raw_type = work.get('type') or 'Publication'
            work_type = raw_type.replace('-', ' ').title()
            content += f"""### {work['title']}

**Year:** {year}  
**Type:** {work_type}

[View Publication →](https://orcid.org/0000-0002-1774-532X)

---

"""
    else:
        content += "*Publications will appear here automatically from ORCID.*\n\n"
    
    content += """---

## Research Philosophy

All research is conducted with a commitment to **open and transparent science**. Data, code, and materials are made available whenever possible to support reproducibility and collaborative advancement of knowledge.
"""
    
    return content


def generate_analysis_page(plot_data: list[PlotData]) -> str:
    """Generate real-time analysis visualization page"""
    content = """+++
title = "Real-Time Research Analysis"
+++

<style>
.analysis-container {
    display: flex;
    gap: 20px;
    margin-top: 20px;
}

.analysis-sidebar {
    width: 300px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    padding: 15px;
    position: sticky;
    top: 20px;
    height: fit-content;
    max-height: calc(100vh - 150px);
    overflow-y: auto;
}

.search-box {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    margin-bottom: 15px;
}

.search-box:focus {
    outline: none;
    border-color: var(--accent-primary);
}

.file-explorer {
    margin-top: 10px;
}

.explorer-header {
    font-size: 0.85rem;
    font-weight: bold;
    color: var(--text-secondary);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.repo-section {
    margin-bottom: 15px;
}

.repo-name {
    font-weight: bold;
    color: var(--accent-primary);
    margin-bottom: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
}

.repo-name:hover {
    color: var(--accent-hover);
}

.repo-toggle {
    font-size: 0.8rem;
}

.file-list {
    margin-left: 15px;
    display: none;
}

.file-list.expanded {
    display: block;
}

.file-item {
    padding: 5px 8px;
    margin: 3px 0;
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    transition: all var(--transition-fast);
}

.file-item:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
}

.file-item.active {
    background: var(--accent-subtle);
    color: var(--accent-primary);
    font-weight: bold;
}

.file-item.hidden-by-search {
    display: none;
}

.analysis-main {
    flex: 1;
    min-width: 0;
}

.no-results {
    color: var(--text-muted);
    font-style: italic;
    padding: 20px;
    text-align: center;
}

.download-btn {
    display: inline-block;
    padding: 6px 12px;
    margin-left: 10px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: none;
    transition: all var(--transition-fast);
}

.download-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
}

.download-all-container {
    margin-bottom: 20px;
    padding: 15px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.download-all-btn {
    padding: 10px 20px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.9rem;
    font-weight: bold;
    cursor: pointer;
    transition: all var(--transition-fast);
}

.download-all-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-2px);
}

@media (max-width: 768px) {
    .analysis-container {
        flex-direction: column;
    }
    
    .analysis-sidebar {
        width: 100%;
        position: relative;
        max-height: 400px;
    }
    
    .download-all-container {
        flex-direction: column;
        gap: 10px;
        text-align: center;
    }
}
</style>

*Live analysis results from deployed experiments. Automatically synchronized from public-facing research repositories.*

<div class="analysis-container">
    <aside class="analysis-sidebar">
        <input type="text" id="search-box" class="search-box" placeholder="Search files...">
        
        <div class="file-explorer">
            <div class="explorer-header">📁 Repositories</div>
            <div id="file-tree"></div>
        </div>
    </aside>

    <main class="analysis-main">
        <div id="plot-loading">Loading analysis results...</div>
        <div id="plot-container"></div>
    </main>
</div>

<script src="https://cdn.plot.ly/plotly-2.27.0.min.js" charset="utf-8"></script>
<script>
// Analysis data embedded from research repositories
const plotsData = """
    
    # Embed plot data as JSON
    content += json.dumps(plot_data, indent=2)
    
    content += """;

// Build file tree from plot data
function buildFileTree() {
    const fileTree = document.getElementById('file-tree');
    
    // Group by repository
    const repoMap = {};
    plotsData.forEach((plot, index) => {
        if (!repoMap[plot.repo_name]) {
            repoMap[plot.repo_name] = [];
        }
        repoMap[plot.repo_name].push({ ...plot, index });
    });
    
    // Create tree structure
    Object.keys(repoMap).sort().forEach(repoName => {
        const repoSection = document.createElement('div');
        repoSection.className = 'repo-section';
        
        const repoHeader = document.createElement('div');
        repoHeader.className = 'repo-name';
        repoHeader.innerHTML = `<span class="repo-toggle">▶</span> ${repoName}`;
        
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        repoMap[repoName].forEach(plot => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.textContent = plot.file_path;
            fileItem.dataset.index = plot.index;
            fileItem.dataset.repoName = plot.repo_name;
            fileItem.dataset.filePath = plot.file_path;
            
            fileItem.onclick = () => {
                // Scroll to plot
                const plotElement = document.getElementById(`plot-${plot.index}`);
                if (plotElement) {
                    plotElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                    // Highlight active file
                    document.querySelectorAll('.file-item').forEach(item => {
                        item.classList.remove('active');
                    });
                    fileItem.classList.add('active');
                }
            };
            
            fileList.appendChild(fileItem);
        });
        
        // Toggle expansion
        repoHeader.onclick = () => {
            const isExpanded = fileList.classList.toggle('expanded');
            repoHeader.querySelector('.repo-toggle').textContent = isExpanded ? '▼' : '▶';
        };
        
        repoSection.appendChild(repoHeader);
        repoSection.appendChild(fileList);
        fileTree.appendChild(repoSection);
    });
    
    // Expand first repo by default
    if (fileTree.firstChild) {
        fileTree.firstChild.querySelector('.repo-name').click();
    }
}

// Search functionality
document.getElementById('search-box')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach(item => {
        const repoName = item.dataset.repoName.toLowerCase();
        const filePath = item.dataset.filePath.toLowerCase();
        const matches = repoName.includes(query) || filePath.includes(query);
        
        if (matches || query === '') {
            item.classList.remove('hidden-by-search');
        } else {
            item.classList.add('hidden-by-search');
        }
    });
});

// Render all analysis results
function renderPlots() {
    const container = document.getElementById('plot-container');
    const loading = document.getElementById('plot-loading');
    
    if (plotsData.length === 0) {
        container.innerHTML = '<div class="no-results">' +
                            '<p><em>No deployed experiments yet. Results will appear here once experiments are ready for public deployment.</em></p>' +
                            '<h3>About This Page</h3>' +
                            '<p>This page displays real-time analysis results from deployed research experiments. ' +
                            'Experiments appear here after analysis pipelines have been validated, pilots completed, and proposals approved.</p>' +
                            '<h3>Deployment Workflow</h3>' +
                            '<ol style="text-align: left; display: inline-block;">' +
                            '<li><strong>Analysis Structure</strong> — Pipeline is developed and matured in backoffice</li>' +
                            '<li><strong>Pilot Testing</strong> — Protocol is validated with pilot participants</li>' +
                            '<li><strong>Proposal Approval</strong> — Research proposal is submitted and approved</li>' +
                            '<li><strong>Public Deployment</strong> — Experiment moves to public-facing repository</li>' +
                            '<li><strong>Real-Time Updates</strong> — Analysis results sync automatically as data is collected</li>' +
                            '</ol>' +
                            '<p><strong>Analysis Toolbox</strong> generates JSON representations at each processing step, ' +
                            'enabling transparent observation of data collection and analysis as it happens.</p>' +
                            '</div>';
        loading.style.display = 'none';
        return;
    }
    
    loading.style.display = 'none';
    
    // Build file tree
    buildFileTree();
    
    plotsData.forEach((plotItem, index) => {
        // Create section for each analysis result
        const section = document.createElement('div');
        section.style.marginBottom = '40px';
        section.style.borderBottom = '1px solid var(--border-primary)';
        section.style.paddingBottom = '20px';
        section.id = `plot-section-${index}`;
        
        // Add metadata
        const header = document.createElement('div');
        header.innerHTML = `
            <h3>📊 ${plotItem.file_path}</h3>
            <p><strong>Repository:</strong> <a href="${plotItem.repo_url}" target="_blank">${plotItem.repo_name}</a></p>
            <p><strong>Last Updated:</strong> ${new Date(plotItem.updated).toLocaleString()}</p>
        `;
        section.appendChild(header);
        
        // Create plot div
        const plotDiv = document.createElement('div');
        plotDiv.id = `plot-${index}`;
        plotDiv.style.width = '100%';
        plotDiv.style.height = '600px';
        plotDiv.style.marginTop = '15px';
        section.appendChild(plotDiv);
        
        container.appendChild(section);
        
        // Try to render with Plotly
        try {
            const plotData = plotItem.plot_data;
            
            // Handle different JSON formats from Analysis Toolbox
            if (plotData.data && plotData.layout) {
                // Plotly JSON format (preferred)
                Plotly.newPlot(`plot-${index}`, plotData.data, plotData.layout, {responsive: true});
            } else if (Array.isArray(plotData)) {
                // Array of traces
                Plotly.newPlot(`plot-${index}`, plotData, {}, {responsive: true});
            } else if (plotData.x && plotData.y) {
                // Simple x, y data
                Plotly.newPlot(`plot-${index}`, [plotData], {}, {responsive: true});
            } else {
                // Unknown format - show JSON
                plotDiv.innerHTML = `<pre style="background: var(--code-bg); padding: 15px; overflow: auto; border-radius: 4px;">${JSON.stringify(plotData, null, 2)}</pre>`;
            }
        } catch (error) {
            plotDiv.innerHTML = `<p style="color: red;">Error rendering analysis: ${error.message}</p>` +
                              `<details><summary>View raw JSON</summary><pre style="background: var(--bg-tertiary); padding: 15px; overflow: auto;">${JSON.stringify(plotItem.plot_data, null, 2)}</pre></details>`;
        }
    });
}

// Render when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPlots);
} else {
    renderPlots();
}
</script>

---

## About Real-Time Analysis

This page provides **transparent access to deployed experimental analyses**. Only experiments that have completed their validation phase (analysis maturation, pilot testing, proposal approval) are moved to public-facing repositories and synchronized here.

### From Development to Deployment

**Backoffice Development** → Analysis structure is built and refined  
**Pilot Validation** → Protocol is tested with pilot participants  
**Proposal Approval** → Research proposal is formally approved  
**Public Deployment** → Experiment repo becomes public-facing  
**Real-Time Sync** → Results automatically update as data is collected

### Analysis Toolbox Integration

The Analysis Toolbox generates JSON representations at each processing step, creating a transparent record of all analytical decisions and data transformations. This enables real-time observation of research workflows from data collection through final analysis.

### Open Science in Practice

By making validated experimental analyses immediately visible, this page embodies open and transparent science. Results are shared as they emerge, not months or years later, fostering trust and enabling real-time scientific discourse.
"""
    
    return content

def save_data_file(data: object, filename: str) -> None:
    """Save data as JSON for use in templates"""
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)
    
    filepath = data_dir / filename
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {filename}")


def load_posted_items() -> TrackedState:
    """Load tracking state for blog posts"""
    data_dir = Path(__file__).parent.parent / 'data'
    filepath = data_dir / 'posted_items.json'
    if filepath.exists():
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Migrate old format if needed
            repos = data.get('repos', {})
            if isinstance(repos, list):
                # Convert list to dict with empty tracking info
                repos = {name: {'last_pushed': '', 'last_posted': ''} for name in repos}
            elif isinstance(repos, dict):
                # Ensure all values are proper dicts (not strings from partial migration)
                for name, val in repos.items():
                    if not isinstance(val, dict):
                        repos[name] = {'last_pushed': '', 'last_posted': ''}
            return {
                'repos': repos,
                'publications': data.get('publications', []),
                'website': data.get('website', {'last_pushed': '', 'last_posted': ''})
            }
    return {'repos': {}, 'publications': [], 'website': {'last_pushed': '', 'last_posted': ''}}


def save_posted_items(posted: TrackedState) -> None:
    """Save tracking state for blog posts"""
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)
    filepath = data_dir / 'posted_items.json'
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(posted, f, indent=2)


def generate_blog_post_for_repo(repo: GitHubRepo) -> tuple[str, str]:
    """Generate a blog post for a new GitHub repository"""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"new-project-{repo['name']}")
    filename = f"{today}-{slug}.md"
    
    lang = repo['language'] or 'Multiple languages'
    
    content = f"""+++
title = "New Project: {repo['name']}"
date = {today}
description = "A new project has been added to my open backoffice"
[taxonomies]
tags = ["project", "github", "new"]
+++

A new project is now available in my [GitHub backoffice](https://github.com/{GITHUB_USERNAME}):

## {repo['name']}

{repo['description']}

**Language:** {lang}

This project contains analysis pipelines, data, and documentation following my commitment to open and transparent science.

[View on GitHub →]({repo['url']}) | [See all projects →](/projects/)
"""
    return filename, content


def generate_blog_post_for_repo_update(repo: GitHubRepo, commits: list[dict]) -> tuple[str, str]:
    """Generate a blog post for repository updates"""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"update-{repo['name']}")
    filename = f"{today}-{slug}.md"
    
    # Format commit messages
    commit_list = ""
    for commit in commits[:5]:
        msg = commit.get('commit', {}).get('message', '').split('\n')[0][:80]
        sha = commit.get('sha', '')[:7]
        commit_list += f"- `{sha}` {msg}\n"
    
    content = f"""+++
title = "Project Update: {repo['name']}"
date = {today}
description = "Recent updates to {repo['name']}"
[taxonomies]
tags = ["project", "github", "update"]
+++

Recent activity in [{repo['name']}]({repo['url']}):

## Recent Commits

{commit_list}

This project is actively maintained as part of my commitment to open and transparent science.

[View on GitHub →]({repo['url']}) | [See all projects →](/projects/)
"""
    return filename, content


def generate_blog_post_for_publication(work: OrcidWork) -> tuple[str, str]:
    """Generate a blog post for a new ORCID publication"""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"new-publication-{work['title'][:40]}")
    filename = f"{today}-{slug}.md"
    
    year = work.get('year') or 'n.d.'
    raw_type = work.get('type') or 'Publication'
    work_type = raw_type.replace('-', ' ').title()
    
    content = f"""+++
title = "New Publication: {work['title']}"
date = {today}
description = "A new publication has been added to my research output"
[taxonomies]
tags = ["publication", "research", "orcid"]
+++

A new publication is now available in my [ORCID front office](https://orcid.org/{ORCID_ID}):

## {work['title']}

**Year:** {year}  
**Type:** {work_type}

This work represents my ongoing commitment to open and transparent science.

[View on ORCID →](https://orcid.org/{ORCID_ID}) | [See all publications →](/publications/)
"""
    return filename, content


def generate_blog_post_for_website_update(commits: list[dict]) -> tuple[str, str]:
    """Generate a blog post for website updates"""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"website-update")
    filename = f"{today}-{slug}.md"
    
    # Format commit messages
    commit_list = ""
    for commit in commits[:5]:
        msg = commit.get('commit', {}).get('message', '').split('\n')[0][:80]
        sha = commit.get('sha', '')[:7]
        commit_list += f"- `{sha}` {msg}\n"
    
    content = f"""+++
title = "Website Update"
date = {today}
description = "Recent updates to this website"
[taxonomies]
tags = ["website", "update", "meta"]
+++

This website has been updated with the following changes:

## Recent Changes

{commit_list}

The site continues to sync automatically with GitHub (projects) and ORCID (publications).

[View source on GitHub →](https://github.com/{GITHUB_USERNAME}/{WEBSITE_REPO})
"""
    return filename, content


def generate_auto_blog_posts(
    github_repos: list[GitHubRepo], 
    orcid_works: list[OrcidWork]
) -> int:
    """Generate blog posts for new projects, publications, and updates"""
    state = load_posted_items()
    blog_dir = Path(__file__).parent.parent / 'content' / 'blog'
    blog_dir.mkdir(exist_ok=True)
    
    new_posts = 0
    today = datetime.now().strftime('%Y-%m-%d')
    
    # Check for new GitHub repos and repo updates
    for repo in github_repos:
        repo_name = repo['name']
        pushed_at = repo.get('pushed_at', '')
        
        if repo_name not in state['repos']:
            # New repo - create announcement post
            slug = slugify(f"new-project-{repo_name}")
            pattern = f"????-??-??-{slug}.md"
            for existing_file in blog_dir.glob(pattern):
                existing_file.unlink()
                print(f"[-] Deleted old blog post: {existing_file.name}")
            
            filename, content = generate_blog_post_for_repo(repo)
            filepath = blog_dir / filename
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            state['repos'][repo_name] = {
                'last_pushed': pushed_at,
                'last_posted': today
            }
            new_posts += 1
            print(f"[+] Created blog post for new project: {repo_name}")
        
        elif pushed_at and repo_name != WEBSITE_REPO:
            # Check if repo was updated since last post
            repo_state = state['repos'].get(repo_name, {})
            last_pushed = repo_state.get('last_pushed', '')
            last_posted = repo_state.get('last_posted', '')
            
            # Only post update if pushed_at changed and at least 7 days since last post
            if pushed_at != last_pushed:
                days_since_post = 999
                if last_posted:
                    try:
                        last_date = datetime.strptime(last_posted, '%Y-%m-%d')
                        days_since_post = (datetime.now() - last_date).days
                    except ValueError:
                        pass
                
                if days_since_post >= 7:
                    # Fetch recent commits
                    commits = fetch_recent_commits(repo)
                    if commits:
                        # Delete old update posts for this repo
                        slug = slugify(f"update-{repo_name}")
                        pattern = f"????-??-??-{slug}.md"
                        for existing_file in blog_dir.glob(pattern):
                            existing_file.unlink()
                            print(f"[-] Deleted old update post: {existing_file.name}")
                        
                        filename, content = generate_blog_post_for_repo_update(repo, commits)
                        filepath = blog_dir / filename
                        with open(filepath, 'w', encoding='utf-8') as f:
                            f.write(content)
                        state['repos'][repo_name] = {
                            'last_pushed': pushed_at,
                            'last_posted': today
                        }
                        new_posts += 1
                        print(f"[+] Created blog post for update: {repo_name}")
                else:
                    # Update pushed_at but not last_posted
                    state['repos'][repo_name] = {
                        'last_pushed': pushed_at,
                        'last_posted': last_posted
                    }
    
    # Check for website updates (5ha99y repo)
    website_repo = next((r for r in github_repos if r['name'] == WEBSITE_REPO), None)
    if website_repo:
        pushed_at = website_repo.get('pushed_at', '')
        website_state = state.get('website', {})
        last_pushed = website_state.get('last_pushed', '')
        last_posted = website_state.get('last_posted', '')
        
        if pushed_at and pushed_at != last_pushed:
            days_since_post = 999
            if last_posted:
                try:
                    last_date = datetime.strptime(last_posted, '%Y-%m-%d')
                    days_since_post = (datetime.now() - last_date).days
                except ValueError:
                    pass
            
            if days_since_post >= 7:
                commits = fetch_recent_commits(website_repo)
                if commits:
                    # Delete old website update posts
                    slug = slugify(f"website-update")
                    pattern = f"????-??-??-{slug}.md"
                    for existing_file in blog_dir.glob(pattern):
                        existing_file.unlink()
                        print(f"[-] Deleted old website update post: {existing_file.name}")
                    
                    filename, content = generate_blog_post_for_website_update(commits)
                    filepath = blog_dir / filename
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    state['website'] = {
                        'last_pushed': pushed_at,
                        'last_posted': today
                    }
                    new_posts += 1
                    print(f"[+] Created blog post for website update")
            else:
                state['website'] = {
                    'last_pushed': pushed_at,
                    'last_posted': last_posted
                }
    
    # Check for new ORCID publications
    for work in orcid_works:
        if work['title'] not in state['publications']:
            # Delete any existing blog posts for this publication
            slug = slugify(f"new-publication-{work['title'][:40]}")
            pattern = f"????-??-??-{slug}.md"
            for existing_file in blog_dir.glob(pattern):
                existing_file.unlink()
                print(f"[-] Deleted old blog post: {existing_file.name}")
            
            filename, content = generate_blog_post_for_publication(work)
            filepath = blog_dir / filename
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            state['publications'].append(work['title'])
            new_posts += 1
            print(f"[+] Created blog post for publication: {work['title']}")
    
    save_posted_items(state)
    return new_posts

def main():
    print("Fetching data from external platforms...")
    
    # Fetch data
    github_repos = fetch_github_repos()
    orcid_works = fetch_orcid_works()
    plot_data = fetch_all_research_plots()
    
    # Save as JSON files for templates
    save_data_file({'repos': github_repos}, 'github.json')
    save_data_file({'works': orcid_works}, 'orcid.json')
    save_data_file({'plots': plot_data}, 'analysis_plots.json')
    
    # Generate separate pages for projects, publications, and analysis
    projects_content = generate_projects_page(github_repos)
    publications_content = generate_publications_page(orcid_works)
    analysis_content = generate_analysis_page(plot_data)
    
    # Save pages
    content_dir = Path(__file__).parent.parent / 'content'
    
    with open(content_dir / 'projects.md', 'w', encoding='utf-8') as f:
        f.write(projects_content)
    
    with open(content_dir / 'publications.md', 'w', encoding='utf-8') as f:
        f.write(publications_content)
    
    with open(content_dir / 'analysis.md', 'w', encoding='utf-8') as f:
        f.write(analysis_content)
    
    # Generate auto blog posts for new items
    new_posts = generate_auto_blog_posts(github_repos, orcid_works)
    
    print(f"[+] Updated {len(github_repos)} GitHub repos")
    print(f"[+] Updated {len(orcid_works)} ORCID works")
    print(f"[+] Found {len(plot_data)} analysis plots")
    print("[+] Generated projects.md")
    print("[+] Generated publications.md")
    print("[+] Generated analysis.md")
    print(f"[+] Created {new_posts} new blog posts")

if __name__ == "__main__":
    main()
