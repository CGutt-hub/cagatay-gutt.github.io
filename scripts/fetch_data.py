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
from datetime import datetime
from pathlib import Path
from typing import TypedDict, Any, cast

# Configuration
GITHUB_USERNAME = "CGutt-hub"
ORCID_ID = "0000-0002-1774-532X"
WEBSITE_REPO = "5ha99y"  # This repo name for tracking website changes

# GitHub API headers with optional token
GITHUB_HEADERS: dict[str, str] = {
    'User-Agent': 'Mozilla/5.0'
}
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
if GITHUB_TOKEN:
    GITHUB_HEADERS['Authorization'] = f'token {GITHUB_TOKEN}'


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
    plot_data: dict[str, Any]  # The actual plot JSON
    updated: str
    repo_url: str
    readme: str | None  # Optional README content from plot directory
    pipeline_trace: dict[str, Any] | None  # Nextflow pipeline execution tree


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
    
    try:
        response = requests.get(url, params={"sort": "updated", "per_page": 20}, headers=GITHUB_HEADERS)
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
                readme_response = requests.get(readme_url, headers={**GITHUB_HEADERS, 'Accept': 'application/vnd.github.v3.raw'})
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


def fetch_recent_commits(repo_name: str, since: str | None = None) -> list[dict[str, Any]]:
    """Fetch recent commits for a repository"""
    url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/commits"
    
    params: dict[str, Any] = {"per_page": 5}
    if since:
        params['since'] = since
    
    try:
        response = requests.get(url, params=params, headers=GITHUB_HEADERS)
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


def parse_nextflow_trace(trace_content: str) -> dict[str, Any]:
    """Parse Nextflow trace file to extract pipeline structure"""
    import csv
    from io import StringIO
    
    try:
        # Parse trace file (TSV format)
        reader = csv.DictReader(StringIO(trace_content), delimiter='\t')
        rows = list(reader)
        
        if not rows:
            return {}
        
        # Build pipeline tree structure
        processes: dict[str, dict[str, Any]] = {}
        process_order: list[str] = []
        
        for row in rows:
            process_name = row.get('name', 'unknown')
            task_id = row.get('task_id', '')
            status = row.get('status', 'UNKNOWN')
            duration = row.get('duration', '')
            cpus = row.get('cpus', '1')
            memory = row.get('memory', '')
            
            # Group by process name (removing task number suffix)
            base_process = process_name.split('(')[0].strip() if '(' in process_name else process_name
            
            if base_process not in processes:
                processes[base_process] = {
                    'name': base_process,
                    'tasks': [],
                    'status': status,
                    'avg_duration': 0,
                    'total_tasks': 0
                }
                process_order.append(base_process)
            
            processes[base_process]['tasks'].append({
                'id': task_id,
                'name': process_name,
                'status': status,
                'duration': duration,
                'cpus': cpus,
                'memory': memory
            })
            processes[base_process]['total_tasks'] += 1
            
            # Update process status (failed > cached > completed)
            # Note: Only final states visible since trace is pushed after completion
            if status == 'FAILED':
                processes[base_process]['status'] = 'FAILED'
            elif status == 'CACHED' and processes[base_process]['status'] not in ['FAILED']:
                processes[base_process]['status'] = 'CACHED'
        
        return {
            'processes': list(processes.values()),
            'process_order': process_order,
            'total_processes': len(processes),
            'total_tasks': sum(p['total_tasks'] for p in processes.values())
        }
    
    except Exception as e:
        print(f"  Error parsing Nextflow trace: {e}")
        return {}


def search_repo_for_participants(repo_name: str, repo_url: str, updated: str) -> list[PlotData]:
    """Search for AnalysisToolbox HTML viewers or fall back to listing parquet files"""
    plot_files: list[PlotData] = []
    
    try:
        # First, check for AnalysisToolbox viewer (e.g., EV_results/.bin/EV_results.html)
        # Try common patterns: {PREFIX}_results/.bin/{PREFIX}_results.html
        results_patterns = [
            ('EV_results', 'EV_results'),
            ('results', repo_name),
            (f"{repo_name}_results", f"{repo_name}_results"),
        ]
        
        for results_dir, viewer_base in results_patterns:
            bin_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/{results_dir}/.bin"
            bin_response = requests.get(bin_url, headers=GITHUB_HEADERS)
            
            if bin_response.status_code == 200:
                bin_contents = bin_response.json()
                if isinstance(bin_contents, list):
                    # Look for HTML viewer
                    viewer_file = f"{viewer_base}.html"
                    html_viewer = next((item for item in bin_contents 
                                       if item.get('name') == viewer_file), None)
                    
                    if html_viewer:
                        # Found AnalysisToolbox viewer! 
                        viewer_url = f"https://{GITHUB_USERNAME.lower()}.github.io/{repo_name}/{results_dir}/.bin/{viewer_file}"
                        raw_viewer_url = f"https://raw.githubusercontent.com/{GITHUB_USERNAME}/{repo_name}/main/{results_dir}/.bin/{viewer_file}"
                        print(f"  ✓ Found AnalysisToolbox viewer: {results_dir}/.bin/{viewer_file}")
                        
                        plot_files.append({
                            'repo_name': repo_name,
                            'file_path': f"{results_dir}/.bin/{viewer_file}",
                            'plot_data': {
                                'type': 'html_viewer',
                                'viewer_url': viewer_url,
                                'raw_viewer_url': raw_viewer_url,
                                'results_dir': results_dir
                            },
                            'updated': updated,
                            'repo_url': repo_url,
                            'readme': None,
                            'pipeline_trace': None
                        })
                        
                        return plot_files  # Return immediately - viewer found!
        
        # Fallback: Check for EV_results directory with participant data
        results_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/EV_results"
        response = requests.get(results_url, headers=GITHUB_HEADERS)
        
        if response.status_code == 200:
            contents = response.json()
            if isinstance(contents, list):
                # Look for participant directories (EV_XXX pattern)
                participant_folders = [
                    item for item in contents 
                    if item.get('type') == 'dir' and 
                    isinstance(item.get('name'), str) and 
                    item['name'].startswith('EV_') and 
                    item['name'][3:].isdigit()
                ]
                
                if participant_folders:
                    print(f"  Found {len(participant_folders)} participant folders, scanning for parquet files...")
                    
                    # Scan each participant folder for parquet files
                    for participant in participant_folders[:5]:  # Limit to first 5 to avoid rate limits
                        participant_name = participant['name']
                        folder_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/EV_results/{participant_name}/plots"
                        
                        try:
                            folder_resp = requests.get(folder_url, headers=GITHUB_HEADERS)
                            if folder_resp.status_code == 200:
                                folder_contents = folder_resp.json()
                                
                                # Find parquet files
                                parquet_files = [
                                    file for file in folder_contents 
                                    if file.get('name', '').endswith('.parquet')
                                ]
                                
                                for pfile in parquet_files:
                                    file_path = f"EV_results/{participant_name}/plots/{pfile['name']}"
                                    plot_files.append({
                                        'repo_name': repo_name,
                                        'file_path': file_path,
                                        'plot_data': {
                                            'type': 'parquet',
                                            'participant': participant_name,
                                            'size': pfile.get('size', 0)
                                        },
                                        'updated': updated,
                                        'repo_url': repo_url,
                                        'readme': None,
                                        'pipeline_trace': None
                                    })
                                
                                print(f"    {participant_name}: {len(parquet_files)} parquet files")
                        except Exception as e:
                            print(f"    Error scanning {participant_name}: {e}")
                            continue
    except Exception as e:
        print(f"  Error checking for participant data: {e}")
    
    return plot_files


def search_repo_for_plots(repo_name: str, repo_url: str, updated: str) -> list[PlotData]:
    """Search a repository for plot JSON files, READMEs, and Nextflow traces"""
    
    # First check if this is a participant-based dataset repository
    participant_plots = search_repo_for_participants(repo_name, repo_url, updated)
    if participant_plots:
        return participant_plots
    
    # Search for files with .json extension in common plot directories
    search_paths = [
        'plots', 'figures', 'results', 'output', 'visualizations', 'analysis',
        'data/plots', 'data/figures', ''  # '' searches root
    ]
    
    plot_files: list[PlotData] = []
    # Track directories that have plots and their READMEs
    readme_cache: dict[str, str | None] = {}
    pipeline_trace: dict[str, Any] | None = None
    
    # First, try to find Nextflow trace file
    try:
        trace_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/.nextflow.log"
        trace_response = requests.get(trace_url, headers=GITHUB_HEADERS)
        if trace_response.status_code == 404:
            # Try trace.txt in root
            trace_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/trace.txt"
            trace_response = requests.get(trace_url, headers=GITHUB_HEADERS)
        
        if trace_response.status_code == 200:
            trace_data = trace_response.json()
            if 'content' in trace_data:
                import base64
                trace_content = base64.b64decode(trace_data['content']).decode('utf-8')
                pipeline_trace = parse_nextflow_trace(trace_content)
                if pipeline_trace:
                    print(f"  Found Nextflow trace with {pipeline_trace.get('total_processes', 0)} processes")
    except Exception as e:
        print(f"  No Nextflow trace found: {e}")
    
    for search_path in search_paths:
        try:
            # Get contents of directory
            url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/{search_path}"
            response = requests.get(url, headers=GITHUB_HEADERS)
            
            if response.status_code != 200:
                continue
            
            contents = response.json()
            if not isinstance(contents, list):
                continue
            
            # Cast to list for type checker
            contents_list = cast(list[Any], contents)
            
            # Look for .json files that might be plots
            for item in contents_list:
                if not isinstance(item, dict):
                    continue
                
                # Cast to dict[str, Any] for type checker
                item_dict = cast(dict[str, Any], item)
                item_type: Any = item_dict.get('type')
                item_name: Any = item_dict.get('name')
                item_download_url: Any = item_dict.get('download_url')
                
                if item_type == 'file' and isinstance(item_name, str) and item_name.endswith('.json'):
                    # Check if it might be a plot file (common naming patterns)
                    name_lower = item_name.lower()
                    if any(keyword in name_lower for keyword in ['plot', 'figure', 'chart', 'graph', 'viz', 'visual']):
                        # Fetch the actual JSON content
                        try:
                            if not isinstance(item_download_url, str):
                                continue
                            json_response = requests.get(item_download_url, headers=GITHUB_HEADERS)
                            if json_response.status_code == 200:
                                plot_json = json_response.json()
                                
                                # Fetch README for this directory if not already cached
                                readme_content: str | None = None
                                if search_path not in readme_cache:
                                    try:
                                        readme_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/contents/{search_path}/README.md" if search_path else f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/readme"
                                        readme_response = requests.get(readme_url, headers=GITHUB_HEADERS)
                                        if readme_response.status_code == 200:
                                            readme_data = readme_response.json()
                                            if 'content' in readme_data:
                                                # Decode base64 content
                                                import base64
                                                readme_content = base64.b64decode(readme_data['content']).decode('utf-8')
                                                readme_cache[search_path] = readme_content
                                                print(f"  Found README for {search_path or 'root'}")
                                            else:
                                                readme_cache[search_path] = None
                                        else:
                                            readme_cache[search_path] = None
                                    except Exception as e:
                                        print(f"  Could not fetch README for {search_path}: {e}")
                                        readme_cache[search_path] = None
                                else:
                                    readme_content = readme_cache[search_path]
                                
                                plot_files.append({
                                    'repo_name': repo_name,
                                    'file_path': f"{search_path}/{item['name']}" if search_path else item['name'],
                                    'plot_data': plot_json,
                                    'updated': updated,
                                    'repo_url': repo_url,
                                    'readme': readme_content,
                                    'pipeline_trace': pipeline_trace
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
    
    # Get all repos
    url = f"https://api.github.com/users/{GITHUB_USERNAME}/repos"
    try:
        response = requests.get(url, params={"sort": "updated", "per_page": 50}, headers=GITHUB_HEADERS)
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

def generate_projects_page(github_repos: list[GitHubRepo], lang: str = 'en') -> str:
    """Generate projects page from GitHub data with collapsible sections"""
    if lang == 'de':
        content = """+++
title = "Code-Projekte & Repositories"
+++

*Aktive Entwicklungsprojekte via [GitHub](https://github.com/CGutt-hub). Mein offenes Backoffice für kollaborative Wissenschaft.*

---

"""
    else:
        content = """+++
title = "Code Projects & Repositories"
+++

*Active development projects tracked via [GitHub](https://github.com/CGutt-hub). My open backoffice for collaborative science.*

---

"""
    
    if not github_repos:
        content += "*Keine Repositories gefunden.*\n" if lang == 'de' else "*No repositories found.*\n"
    else:
        for repo in github_repos:
            stars = f" ⭐ {repo['stars']}" if repo['stars'] > 0 else ""
            repo_lang = repo['language'] or ("Unbekannt" if lang == 'de' else "Unknown")
            if lang == 'de':
                content += f"""### {repo['name']}

**Sprache:** {repo_lang}{stars}  
**Zuletzt aktualisiert:** {repo['updated'][:10]}

<details>
<summary>README anzeigen</summary>

{repo['readme']}

</details>

[Auf GitHub ansehen →]({repo['url']})

---

"""
            else:
                content += f"""### {repo['name']}

**Language:** {repo_lang}{stars}  
**Last updated:** {repo['updated'][:10]}

<details>
<summary>View README</summary>

{repo['readme']}

</details>

[View on GitHub →]({repo['url']})

---

"""
    
    if lang == 'de':
        content += """
## Entwicklungsphilosophie

Aller Code wird mit dem Engagement für **offene und transparente Wissenschaft** entwickelt. Werkzeuge, Pipelines und Analysecode werden verfügbar gemacht, um Reproduzierbarkeit und kollaborativen Wissensfortschritt zu unterstützen.
"""
    else:
        content += """
## Development Philosophy

All code is developed with a commitment to **open and transparent science**. Tools, pipelines, and analysis code are made available to support reproducibility and collaborative advancement of knowledge.
"""
    
    return content

def generate_publications_page(orcid_works: list[OrcidWork], lang: str = 'en') -> str:
    """Generate publications page from ORCID data (complete research output)"""
    if lang == 'de':
        content = """+++
title = "Forschungspublikationen"
+++

*Vollständiger Forschungsoutput via [ORCID](https://orcid.org/0000-0002-1774-532X). Mein offenes Frontoffice für formale Forschung.*

---

"""
    else:
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
            if lang == 'de':
                content += f"""### {work['title']}

**Jahr:** {year}  
**Typ:** {work_type}

[Publikation ansehen →](https://orcid.org/0000-0002-1774-532X)

---

"""
            else:
                content += f"""### {work['title']}

**Year:** {year}  
**Type:** {work_type}

[View Publication →](https://orcid.org/0000-0002-1774-532X)

---

"""
    else:
        content += "*Publikationen erscheinen hier automatisch von ORCID.*\n\n" if lang == 'de' else "*Publications will appear here automatically from ORCID.*\n\n"
    
    content += """---

"""
    if lang == 'de':
        content += """## Forschungsphilosophie

Alle Forschung wird mit dem Engagement für **offene und transparente Wissenschaft** durchgeführt. Daten, Code und Materialien werden wann immer möglich verfügbar gemacht, um Reproduzierbarkeit und kollaborativen Wissensfortschritt zu unterstützen.
"""
    else:
        content += """## Research Philosophy

All research is conducted with a commitment to **open and transparent science**. Data, code, and materials are made available whenever possible to support reproducibility and collaborative advancement of knowledge.
"""
    
    return content


def generate_analysis_page(plot_data: list[PlotData], lang: str = 'en') -> str:
    """Generate analysis data page with simple list format like projects/publications"""
    if lang == 'de':
        title = "Offene Daten"
        intro = "*Echtzeit-Analyseergebnisse aus laufenden Forschungsprojekten. Daten werden direkt aus den Quell-Repositories geladen.*"
        no_data_msg = "Noch keine Experimente bereitgestellt"
        no_data_desc = "Ergebnisse erscheinen hier, sobald Experimente für die öffentliche Bereitstellung bereit sind."
        participants_label = "Teilnehmer"
        view_label = "🔬 Interaktiven Viewer öffnen"
    else:
        title = "Open Data"
        intro = "*Real-time analysis results from ongoing research projects. Data is loaded directly from source repositories.*"
        no_data_msg = "No deployed experiments yet"
        no_data_desc = "Results will appear here once experiments are ready for public deployment."
        participants_label = "participants"
        view_label = "🔬 View Interactive Results"
    
    content = f"""+++
title = "{title}"
+++

{intro}

---

"""
    
    if not plot_data:
        content += f"""
### {no_data_msg}

{no_data_desc}

**Deployment Workflow:**

1. **Analysis Structure** — Pipeline is developed and matured in backoffice
2. **Pilot Testing** — Protocol is validated with pilot participants  
3. **Proposal Approval** — Research proposal is submitted and approved
4. **Public Deployment** — Experiment moves to public-facing repository
5. **Real-Time Updates** — Analysis results sync automatically as data is collected

**Analysis Toolbox** generates structured outputs at each processing step, enabling transparent observation of data collection and analysis as it happens.
"""
        return content
    
    for plot in plot_data:
        repo_name = plot['repo_name']
        repo_url = plot['repo_url']
        updated = plot['updated']
        plot_info = plot['plot_data']
        
        # Format update date
        from datetime import datetime
        update_date = datetime.fromisoformat(updated.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        
        content += f"### [{repo_name}]({repo_url})\n\n"
        
        # Handle participant archives (continuous analysis datasets)
        if plot_info.get('type') == 'participant_archive':
            participant_count = plot_info.get('participant_count', 0)
            viewer_url = plot_info.get('viewer_url')
            
            content += f"**Status:** {participant_count} {participants_label}  \n"
            content += f"**Last updated:** {update_date}\n\n"
            
            if viewer_url:
                content += f"[{view_label}]({viewer_url}){{target=\"_blank\"}}\n\n"
                
                # Show participant list if available
                participants = plot_info.get('participants', [])
                if participants:
                    content += "<details>\n"
                    content += f"<summary>📁 {participants_label.capitalize()}</summary>\n\n"
                    for p in participants:
                        content += f"- {p}\n"
                    content += "\n</details>\n\n"
            else:
                content += f"*Viewer deployment pending*\n\n"
        
        # Handle regular plot JSONs (future)
        else:
            file_path = plot['file_path']
            content += f"**File:** {file_path}  \n"
            content += f"**Last updated:** {update_date}\n\n"
        
        content += "---\n\n"
    
    return content

"""
OLD BROKEN CODE - COMMENTED OUT
def save_data_file(data: object, filename: str) -> None:
    pass
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadPlotData(plotItem) {
    const filename = `${plotItem.repo_name}_${plotItem.file_path.replace(/\\//g, '_')}`;
    downloadJSON(plotItem, filename);
}

async function findParquetFile(plotItem) {
    // Try to find associated parquet file by checking common patterns
    const basePath = plotItem.file_path.replace(/\\.json$/, '').replace(/[_-]?(plot|figure|viz|visual|chart|graph)s?/i, '');
    const dirPath = plotItem.file_path.substring(0, plotItem.file_path.lastIndexOf('/'));
    
    const possiblePaths = [
        basePath + '.parquet',
        basePath + '_data.parquet',
        dirPath + '/data.parquet',
        dirPath + '/processed_data.parquet',
        'data.parquet',
        'processed_data.parquet'
    ];
    
    // Try to fetch each possible parquet file
    for (const path of possiblePaths) {
        try {
            const url = `https://raw.githubusercontent.com/CGutt-hub/${plotItem.repo_name}/main/${path}`;
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                return { data: arrayBuffer, filename: path.split('/').pop() };
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function downloadPlotPDFA(plotItem, plotIndex) {
    try {
        // Wait for pdf-lib to load
        if (typeof PDFLib === 'undefined') {
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (typeof PDFLib !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        }
        
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        
        // Convert plot to grayscale image
        const plotContainer = document.getElementById(`plot-container-${plotIndex}`);
        const plotImageDataUrl = await Plotly.toImage(plotContainer, {
            format: 'png',
            width: 1200,
            height: 800
        });
        
        // Convert to grayscale
        const img = new Image();
        img.src = plotImageDataUrl;
        await new Promise(resolve => img.onload = resolve);
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Convert to grayscale
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
        const grayscaleImageUrl = canvas.toDataURL('image/png');
        
        // Create PDF document
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([842, 595]); // A4 landscape in points
        const { width, height } = page.getSize();
        
        // Embed font
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        
        // Add title
        page.drawText(plotItem.file_path, {
            x: 50,
            y: height - 50,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
        });
        
        // Add repository info
        page.drawText(`Repository: ${plotItem.repo_name}`, {
            x: 50,
            y: height - 75,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        page.drawText(`Updated: ${new Date(plotItem.updated).toLocaleString()}`, {
            x: 50,
            y: height - 90,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        // Embed grayscale plot image
        const imageBytes = await fetch(grayscaleImageUrl).then(res => res.arrayBuffer());
        const pngImage = await pdfDoc.embedPng(imageBytes);
        const imgDims = pngImage.scale(0.6);
        
        page.drawImage(pngImage, {
            x: 50,
            y: 100,
            width: imgDims.width,
            height: imgDims.height
        });
        
        // Try to fetch and embed parquet file as attachment
        const parquetFile = await findParquetFile(plotItem);
        if (parquetFile) {
            // Attach parquet file to PDF
            await pdfDoc.attach(parquetFile.data, parquetFile.filename, {
                mimeType: 'application/octet-stream',
                description: 'Source data in Apache Parquet format',
                creationDate: new Date(plotItem.updated),
                modificationDate: new Date(plotItem.updated)
            });
            
            // Add note about attachment
            page.drawText('📎 Source data attached as: ' + parquetFile.filename, {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0, 0.5, 0)
            });
        } else {
            // Add note about no attachment
            page.drawText('⚠ No source parquet file found', {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0.7, 0.3, 0)
            });
        }
        
        // Set PDF metadata
        pdfDoc.setTitle(plotItem.file_path);
        pdfDoc.setAuthor('Çağatay Özcan Jagiello Gutt');
        pdfDoc.setSubject(`Research data from ${plotItem.repo_name}`);
        pdfDoc.setKeywords(['research', 'open data', 'analysis']);
        pdfDoc.setCreator('Open Data - 5ha99y');
        pdfDoc.setProducer('pdf-lib (https://pdf-lib.js.org)');
        
        // Save PDF
        const pdfBytes = await pdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const pdfFilename = `${plotItem.repo_name.replace(/\\//g, '_')}_${plotItem.file_path.replace(/\\//g, '_').replace('.json', '')}.pdf`;
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pdfBlob);
        a.download = pdfFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        
        if (parquetFile) {
            alert('Downloaded PDF/A with embedded parquet data attachment');
        } else {
            alert('Downloaded PDF (no source parquet file found)');
        }
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert(`Error generating PDF: ${error.message}`);
    }
}

function downloadAllData() {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `research-analysis-export_${timestamp}.json`;
    const exportData = {
        export_date: new Date().toISOString(),
        total_plots: plotsData.length,
        data: plotsData
    };
    downloadJSON(exportData, filename);
}

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
        repoHeader.innerHTML = `<span class="repo-toggle">▶</span> 📁 ${repoName}`;
        
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        repoMap[repoName].forEach(plot => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.dataset.index = plot.index;
            fileItem.dataset.repoName = plot.repo_name;
            fileItem.dataset.filePath = plot.file_path;
            
            // Create file name span
            const fileName = document.createElement('span');
            fileName.textContent = plot.file_path;
            fileName.style.flex = '1';
            fileName.style.cursor = 'pointer';
            fileName.onclick = () => {
                showPlot(plot.index);
            };
            
            // Create download buttons container
            const downloadBtns = document.createElement('div');
            downloadBtns.style.display = 'flex';
            downloadBtns.style.gap = '4px';
            downloadBtns.style.marginLeft = '8px';
            
            // JSON download button
            const jsonBtn = document.createElement('button');
            jsonBtn.innerHTML = '📥';
            jsonBtn.title = 'Download JSON';
            jsonBtn.className = 'sidebar-download-btn';
            jsonBtn.style.padding = '2px 6px';
            jsonBtn.style.fontSize = '0.75em';
            jsonBtn.style.border = '1px solid var(--border-primary)';
            jsonBtn.style.borderRadius = '3px';
            jsonBtn.style.background = 'var(--bg-tertiary)';
            jsonBtn.style.cursor = 'pointer';
            jsonBtn.onclick = (e) => {
                e.stopPropagation();
                downloadPlotData(plotsData[plot.index]);
            };
            
            // PDF/A download button
            const pdfBtn = document.createElement('button');
            pdfBtn.innerHTML = '📄';
            pdfBtn.title = 'Download PDF/A + Parquet';
            pdfBtn.className = 'sidebar-download-btn';
            pdfBtn.style.padding = '2px 6px';
            pdfBtn.style.fontSize = '0.75em';
            pdfBtn.style.border = '1px solid var(--border-primary)';
            pdfBtn.style.borderRadius = '3px';
            pdfBtn.style.background = 'var(--bg-tertiary)';
            pdfBtn.style.cursor = 'pointer';
            pdfBtn.onclick = (e) => {
                e.stopPropagation();
                downloadPlotPDFA(plotsData[plot.index], plot.index);
            };
            
            downloadBtns.appendChild(jsonBtn);
            downloadBtns.appendChild(pdfBtn);
            
            fileItem.appendChild(fileName);
            fileItem.appendChild(downloadBtns);
            fileItem.style.display = 'flex';
            fileItem.style.alignItems = 'center';
            
            fileList.appendChild(fileItem);
        });
        
        // Toggle expansion
        repoHeader.onclick = () => {
            const isExpanded = fileList.classList.toggle('expanded');
            const toggleIcon = repoHeader.querySelector('.repo-toggle');
            toggleIcon.textContent = isExpanded ? '▼' : '▶';
            toggleIcon.classList.toggle('expanded', isExpanded);
        };
        
        repoSection.appendChild(repoHeader);
        repoSection.appendChild(fileList);
        fileTree.appendChild(repoSection);
    });
    
    // Expand first repo and show first plot by default
    if (fileTree.firstChild) {
        const firstRepo = fileTree.firstChild.querySelector('.repo-name');
        firstRepo.click();
        const firstFile = fileTree.firstChild.querySelector('.file-item span');
        if (firstFile) {
            firstFile.click();
        }
    }
}

// Show a specific plot
function showPlot(index) {
    // Update active state in sidebar
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-index="${index}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Hide empty state and all plots
    document.getElementById('empty-state').style.display = 'none';
    document.querySelectorAll('.plot-display').forEach(plot => {
        plot.classList.remove('active');
    });
    
    // Show selected plot
    const plotDisplay = document.getElementById(`plot-${index}`);
    if (plotDisplay) {
        plotDisplay.classList.add('active');
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
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    const downloadSection = document.getElementById('download-all-section');
    
    if (plotsData.length === 0) {
        emptyState.innerHTML = `
            <h2>No deployed experiments yet</h2>
            <p><em>Results will appear here once experiments are ready for public deployment.</em></p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-primary);">
            <h3>About This Page</h3>
            <p style="max-width: 600px; margin: 15px auto;">
                This page displays real-time analysis results from deployed research experiments. 
                Experiments appear here after analysis pipelines have been validated, pilots completed, and proposals approved.
            </p>
            <h3 style="margin-top: 30px;">Deployment Workflow</h3>
            <ol style="text-align: left; max-width: 600px; margin: 15px auto; line-height: 1.8;">
                <li><strong>Analysis Structure</strong> — Pipeline is developed and matured in backoffice</li>
                <li><strong>Pilot Testing</strong> — Protocol is validated with pilot participants</li>
                <li><strong>Proposal Approval</strong> — Research proposal is submitted and approved</li>
                <li><strong>Public Deployment</strong> — Experiment moves to public-facing repository</li>
                <li><strong>Real-Time Updates</strong> — Analysis results sync automatically as data is collected</li>
            </ol>
            <p style="max-width: 600px; margin: 20px auto;">
                <strong>Analysis Toolbox</strong> generates JSON representations at each processing step, 
                enabling transparent observation of data collection and analysis as it happens.
            </p>
        `;
        return;
    }
    
    // Hide empty state and show download section
    emptyState.style.display = 'none';
    downloadSection.classList.add('visible');
    document.getElementById('download-all-btn').onclick = downloadAllData;
    
    // Build file tree
    buildFileTree();
    
    // Create a display for each plot
    plotsData.forEach((plotItem, index) => {
        const plotDisplay = document.createElement('div');
        plotDisplay.className = 'plot-display';
        plotDisplay.id = `plot-${index}`;
        
        // Header with metadata
        const header = document.createElement('div');
        header.className = 'plot-header';
        header.innerHTML = `
            <h2>📊 ${plotItem.file_path}</h2>
            <div class="plot-meta">
                <p><strong>Repository:</strong> <a href="${plotItem.repo_url}" target="_blank">${plotItem.repo_name}</a></p>
                <p><strong>Last Updated:</strong> ${new Date(plotItem.updated).toLocaleString()}</p>
            </div>
        `;
        plotDisplay.appendChild(header);
        
        // Add README section if available
        if (plotItem.readme) {
            const readmeSection = document.createElement('details');
            readmeSection.className = 'readme-section';
            readmeSection.style.margin = '15px 0';
            readmeSection.style.padding = '15px';
            readmeSection.style.background = 'var(--bg-secondary, #f8f9fa)';
            readmeSection.style.borderRadius = '4px';
            readmeSection.style.border = '1px solid var(--border-primary, #ddd)';
            
            const summary = document.createElement('summary');
            summary.style.cursor = 'pointer';
            summary.style.fontWeight = 'bold';
            summary.style.marginBottom = '10px';
            summary.textContent = '📖 Context & Documentation';
            
            const readmeContent = document.createElement('div');
            readmeContent.className = 'readme-content';
            readmeContent.style.marginTop = '10px';
            readmeContent.style.lineHeight = '1.6';
            // Simple markdown-to-HTML (basic support for common patterns)
            let htmlContent = plotItem.readme
                .replace(/^### (.+)$/gm, '<h4>$1</h4>')
                .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                .replace(/^# (.+)$/gm, '<h2>$1</h2>')
                .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/\\[(.+?)\\]\\((.+?)\\)/g, '<a href="$2" target="_blank">$1</a>')
                .replace(/\\n\\n/g, '</p><p>')
                .replace(/^(.+)$/gm, '<p>$1</p>');
            readmeContent.innerHTML = htmlContent;
            
            readmeSection.appendChild(summary);
            readmeSection.appendChild(readmeContent);
            plotDisplay.appendChild(readmeSection);
        }
        
        // Add Pipeline Tree section if available
        if (plotItem.pipeline_trace && plotItem.pipeline_trace.processes) {
            const pipelineSection = document.createElement('details');
            pipelineSection.className = 'pipeline-section';
            pipelineSection.style.margin = '15px 0';
            pipelineSection.style.padding = '15px';
            pipelineSection.style.background = 'var(--bg-secondary, #f0f4f8)';
            pipelineSection.style.borderRadius = '4px';
            pipelineSection.style.border = '1px solid var(--border-primary, #ddd)';
            pipelineSection.setAttribute('open', '');
            
            const pipelineSummary = document.createElement('summary');
            pipelineSummary.style.cursor = 'pointer';
            pipelineSummary.style.fontWeight = 'bold';
            pipelineSummary.style.marginBottom = '15px';
            pipelineSummary.textContent = `🔄 Analysis Pipeline (${plotItem.pipeline_trace.total_processes} processes, ${plotItem.pipeline_trace.total_tasks} tasks completed)`;
            
            const pipelineContent = document.createElement('div');
            pipelineContent.className = 'pipeline-content';
            pipelineContent.style.marginTop = '15px';
            
            // Add explanatory note
            const note = document.createElement('div');
            note.style.fontSize = '0.85em';
            note.style.color = 'var(--text-secondary)';
            note.style.marginBottom = '15px';
            note.style.padding = '8px 12px';
            note.style.background = 'var(--bg-tertiary, #e9ecef)';
            note.style.borderRadius = '4px';
            note.innerHTML = '📊 This shows the complete analysis workflow from a participant run. Each process represents a step in the data processing pipeline.';
            pipelineContent.appendChild(note);
            
            // Create visual pipeline tree
            const pipelineTree = document.createElement('div');
            pipelineTree.style.display = 'flex';
            pipelineTree.style.flexDirection = 'column';
            pipelineTree.style.gap = '10px';
            pipelineTree.style.fontFamily = 'var(--font-mono, monospace)';
            pipelineTree.style.fontSize = '0.9em';
            
            plotItem.pipeline_trace.processes.forEach((process, idx) => {
                const processNode = document.createElement('div');
                processNode.style.display = 'flex';
                processNode.style.alignItems = 'center';
                processNode.style.gap = '10px';
                processNode.style.padding = '10px';
                processNode.style.borderRadius = '6px';
                processNode.style.background = 'var(--bg-primary, white)';
                processNode.style.border = '2px solid';
                
                // Color based on status (only final states visible in public repo)
                let borderColor = '#28a745';  // Default: completed
                let statusIcon = '✅';
                if (process.status === 'FAILED') {
                    borderColor = '#dc3545';
                    statusIcon = '❌';
                } else if (process.status === 'CACHED') {
                    borderColor = '#17a2b8';
                    statusIcon = '💾';
                } else if (process.status === 'COMPLETED') {
                    borderColor = '#28a745';
                    statusIcon = '✅';
                }
                processNode.style.borderColor = borderColor;
                
                // Add connection line to previous process
                if (idx > 0) {
                    const connector = document.createElement('div');
                    connector.style.width = '2px';
                    connector.style.height = '10px';
                    connector.style.background = '#6c757d';
                    connector.style.marginLeft = '30px';
                    pipelineTree.appendChild(connector);
                }
                
                // Process content
                processNode.innerHTML = `
                    <span style="font-size: 1.2em;">${statusIcon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: var(--text-primary);">${process.name}</div>
                        <div style="font-size: 0.85em; color: var(--text-secondary);">
                            Status: ${process.status} | Tasks: ${process.total_tasks}
                        </div>
                    </div>
                `;
                
                pipelineTree.appendChild(processNode);
            });
            
            pipelineContent.appendChild(pipelineTree);
            pipelineSection.appendChild(pipelineSummary);
            pipelineSection.appendChild(pipelineContent);
            plotDisplay.appendChild(pipelineSection);
        }
        
        // Plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'plot-container';
        plotContainer.id = `plot-container-${index}`;
        plotDisplay.appendChild(plotContainer);
        
        plotDisplays.appendChild(plotDisplay);
        
        // Render plot with Plotly
        try {
            const plotData = plotItem.plot_data;
            
            // Handle participant archive (continuous analysis datasets)
            if (plotData.type === 'participant_archive') {
                if (plotData.viewer_url) {
                    plotContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center;">
                            <p style="font-size: 1.1rem; margin-bottom: 20px; color: var(--text-primary);">
                                <strong>📊 Interactive Analysis Archive</strong>
                            </p>
                            <p style="margin-bottom: 20px; color: var(--text-secondary);">
                                This repository contains ${plotData.participant_count} participant datasets with real-time analysis results.
                                Click below to explore the interactive viewer with filtering, export, and procedural workflow visualization.
                            </p>
                            <a href="${plotData.viewer_url}" target="_blank" 
                               style="display: inline-block; padding: 12px 24px; background: var(--accent-primary); 
                                      color: white; text-decoration: none; border-radius: 6px; font-weight: 600;
                                      transition: all 0.2s;">
                                🔬 Open Interactive Viewer
                            </a>
                            <details style="margin-top: 30px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                                <summary style="cursor: pointer; font-weight: 600; margin-bottom: 10px;">📁 Participant Datasets</summary>
                                <ul style="line-height: 1.8; color: var(--text-secondary);">
                                    ${plotData.participants.map(p => '<li>' + p + '</li>').join('')}
                                </ul>
                            </details>
                        </div>
                    `;
                } else {
                    plotContainer.innerHTML = `
                        <div style="padding: 20px; color: var(--text-secondary);">
                            <p>📊 This repository contains ${plotData.participant_count} participant datasets.</p>
                            <p style="margin-top: 10px;">HTML viewer not yet deployed. Run <code>zola build</code> to deploy.</p>
                        </div>
                    `;
                }
            }
            // Handle different JSON formats from Analysis Toolbox
            else if (plotData.data && plotData.layout) {
                // Plotly JSON format (preferred)
                Plotly.newPlot(`plot-container-${index}`, plotData.data, plotData.layout, {responsive: true});
            } else if (Array.isArray(plotData)) {
                // Array of traces
                Plotly.newPlot(`plot-container-${index}`, plotData, {}, {responsive: true});
            } else if (plotData.x && plotData.y) {
                // Simple x, y data
                Plotly.newPlot(`plot-container-${index}`, [plotData], {}, {responsive: true});
            } else {
                // Unknown format - show JSON
                plotContainer.innerHTML = `
                    <pre style="background: var(--code-bg); padding: 15px; overflow: auto; border-radius: 4px; height: 100%;">
                        ${JSON.stringify(plotData, null, 2)}
                    </pre>
                `;
            }
        } catch (error) {
            plotContainer.innerHTML = `
                <div style="padding: 20px; color: var(--text-secondary);">
                    <p style="color: red; margin-bottom: 10px;">⚠️ Error rendering analysis: ${error.message}</p>
                    <details>
                        <summary style="cursor: pointer; margin-bottom: 10px;">View raw JSON</summary>
                        <pre style="background: var(--bg-tertiary); padding: 15px; overflow: auto; border-radius: 4px;">
                            ${JSON.stringify(plotItem.plot_data, null, 2)}
                        </pre>
                    </details>
                </div>
            `;
        }
    });
}

// Render when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPlots);
} else {
}
"""

def save_data_file(data: object, filename: str) -> None:
    """Save data as JSON for use in templates"""
    # Save to data/ for Python/template use
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)
    
    filepath = data_dir / filename
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Also save to static/data/ for client-side JavaScript access
    static_data_dir = Path(__file__).parent.parent / 'static' / 'data'
    static_data_dir.mkdir(parents=True, exist_ok=True)
    
    static_filepath = static_data_dir / filename
    with open(static_filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {filename} (data/ and static/data/)")



def load_posted_items() -> TrackedState:
    """Load tracking state for blog posts"""
    data_dir = Path(__file__).parent.parent / 'data'
    filepath = data_dir / 'posted_items.json'
    if filepath.exists():
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Migrate old format if needed
            repos_raw = data.get('repos', {})
            repos: dict[str, RepoTrackingInfo] = {}
            
            if isinstance(repos_raw, list):
                # Convert list to dict with empty tracking info
                repos_list = cast(list[Any], repos_raw)
                for name in repos_list:
                    if isinstance(name, str):
                        repos[name] = {'last_pushed': '', 'last_posted': ''}
            elif isinstance(repos_raw, dict):
                # Ensure all values are proper dicts (not strings from partial migration)
                repos_dict = cast(dict[str, Any], repos_raw)
                for name, val in repos_dict.items():
                    if isinstance(val, dict):
                        val_dict = cast(dict[str, Any], val)
                        if 'last_pushed' in val_dict and 'last_posted' in val_dict:
                            last_pushed: Any = val_dict.get('last_pushed', '')
                            last_posted: Any = val_dict.get('last_posted', '')
                            repos[name] = {'last_pushed': str(last_pushed), 'last_posted': str(last_posted)}
                        else:
                            repos[name] = {'last_pushed': '', 'last_posted': ''}
                    else:
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


def generate_blog_post_for_repo_update(repo: GitHubRepo, commits: list[dict[str, Any]]) -> tuple[str, str]:
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


def generate_blog_post_for_website_update(commits: list[dict[str, Any]]) -> tuple[str, str]:
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
                    commits = fetch_recent_commits(repo['name'])
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
                commits = fetch_recent_commits(website_repo['name'])
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
    save_data_file(plot_data, 'analysis_plots.json')  # Save array directly for JS
    
    # Generate separate pages for projects, publications, and analysis (EN + DE)
    projects_content_en = generate_projects_page(github_repos, 'en')
    projects_content_de = generate_projects_page(github_repos, 'de')
    publications_content_en = generate_publications_page(orcid_works, 'en')
    publications_content_de = generate_publications_page(orcid_works, 'de')
    analysis_content_en = generate_analysis_page(plot_data, 'en')
    analysis_content_de = generate_analysis_page(plot_data, 'de')
    
    # Save pages
    content_dir = Path(__file__).parent.parent / 'content'
    
    with open(content_dir / 'projects.md', 'w', encoding='utf-8') as f:
        f.write(projects_content_en)
    
    with open(content_dir / 'projects.de.md', 'w', encoding='utf-8') as f:
        f.write(projects_content_de)
    
    with open(content_dir / 'publications.md', 'w', encoding='utf-8') as f:
        f.write(publications_content_en)
    
    with open(content_dir / 'publications.de.md', 'w', encoding='utf-8') as f:
        f.write(publications_content_de)
    
    with open(content_dir / 'analysis.md', 'w', encoding='utf-8') as f:
        f.write(analysis_content_en)
    
    with open(content_dir / 'analysis.de.md', 'w', encoding='utf-8') as f:
        f.write(analysis_content_de)
    
    # Generate auto blog posts for new items
    new_posts = generate_auto_blog_posts(github_repos, orcid_works)
    
    print(f"[+] Updated {len(github_repos)} GitHub repos")
    print(f"[+] Updated {len(orcid_works)} ORCID works")
    print(f"[+] Found {len(plot_data)} analysis plots")
    print("[+] Generated projects.md + projects.de.md")
    print("[+] Generated publications.md + publications.de.md")
    print("[+] Generated analysis.md + analysis.de.md")
    print(f"[+] Created {new_posts} new blog posts")

if __name__ == "__main__":
    main()
