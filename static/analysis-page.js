// Open Data Analysis Page JavaScript
// Fetches and renders parquet files directly from GitHub repos

// Load parquet parsing library
const parquetScript = document.createElement('script');
parquetScript.src = 'https://cdn.jsdelivr.net/npm/parquetjs-lite@2.3.0/dist/parquetjs-lite.min.js';
document.head.appendChild(parquetScript);

// Load pdf-lib for PDF/A-3 generation with attachments
const pdfLibScript = document.createElement('script');
pdfLibScript.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
document.head.appendChild(pdfLibScript);

// Global variable for plot data (loaded from JSON)
let plotsData = [];

// Download functions for open data sharing
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
    const filename = `${plotItem.repo_name}_${plotItem.file_path.replace(/\//g, '_')}`;
    downloadJSON(plotItem, filename);
}

// Fetch and parse parquet file from GitHub repo
// Supports two call signatures:
//   fetchParquetData(repoName, filePath) - legacy format
//   fetchParquetData(url) - when url is provided directly
async function fetchParquetData(repoNameOrUrl, filePath = null) {
    try {
        // Construct raw GitHub URL
        const url = filePath 
            ? `https://raw.githubusercontent.com/CGutt-hub/${repoNameOrUrl}/main/${filePath}`
            : repoNameOrUrl;
        
        // Fetch the file
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        
        // Wait for parquet library to load
        if (typeof parquet === 'undefined') {
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (typeof parquet !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                }, 5000);
            });
        }
        
        // Parse parquet file
        const reader = await parquet.ParquetReader.openBuffer(new Uint8Array(arrayBuffer));
        const cursor = reader.getCursor();
        const rows = [];
        let record = null;
        
        while (record = await cursor.next()) {
            rows.push(record);
        }
        
        await reader.close();
        
        return { rows, arrayBuffer };
    } catch (error) {
        console.error('Error fetching/parsing parquet:', error);
        throw error;
    }
}

// Convert parquet data to Plotly format
// Supports two call signatures:
//   parquetToPlotly(rows) - when rows are already parsed
//   parquetToPlotly(arrayBuffer, title) - when arrayBuffer needs parsing
async function parquetToPlotly(rowsOrBuffer, title = null) {
    let rows;
    
    // Handle arrayBuffer input (parse it first)
    if (rowsOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(rowsOrBuffer)) {
        if (typeof parquet === 'undefined') {
            throw new Error('Parquet library not loaded yet');
        }
        const reader = await parquet.ParquetReader.openBuffer(new Uint8Array(rowsOrBuffer));
        const cursor = reader.getCursor();
        rows = [];
        let record = null;
        while (record = await cursor.next()) {
            rows.push(record);
        }
        await reader.close();
    } else {
        rows = rowsOrBuffer;
    }
    
    if (!rows || rows.length === 0) {
        return null;
    }
    
    // Detect column types  
    const firstRow = rows[0];
    const columns = Object.keys(firstRow);
    
    // Simple heuristic: if we have x/y or time/value columns, create line plot
    const xCol = columns.find(c => c.toLowerCase().match(/^(x|time|timestamp|index)$/)) || columns[0];
    const yCol = columns.find(c => c.toLowerCase().match(/^(y|value|signal|data)$/)) || columns[1];
    
    if (!yCol) {
        return null;
    }
    
    // Extract x and y data
    const xData = rows.map(r => r[xCol]);
    const yData = rows.map(r => r[yCol]);
    
    const trace = {
        x: xData,
        y: yData,
        type: 'scatter',
        mode: 'lines+markers',
        name: yCol,
        marker: { size: 4 }
    };
    
    const layout = {
        title: title || `${yCol} vs ${xCol}`,
        xaxis: { title: xCol },
        yaxis: { title: yCol },
        hovermode: 'closest'
    };
    
    return { data: [trace], layout };
}

async function findParquetFile(plotItem) {
    // Try to find associated parquet file by checking common patterns
    const basePath = plotItem.file_path.replace(/\.json$/, '').replace(/[_-]?(plot|figure|viz|visual|chart|graph)s?/i, '');
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
        const pdfFilename = `${plotItem.repo_name.replace(/\//g, '_')}_${plotItem.file_path.replace(/\//g, '_').replace('.json', '')}.pdf`;
        
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
    const sidebar = document.querySelector('.analysis-sidebar');
    
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
    
    // Check if first item is html_viewer type
    const firstPlot = plotsData[0];
    if (firstPlot && firstPlot.plot_data && firstPlot.plot_data.type === 'html_viewer') {
        // Hide empty state for html_viewer
        emptyState.style.display = 'none';
        
        // Build EmotiView-style file tree for html_viewer
        const plotData = firstPlot.plot_data;
        const repoPath = firstPlot.repo_name.includes('/') ? firstPlot.repo_name : 'CGutt-hub/' + firstPlot.repo_name;
        const resultsDir = plotData.results_dir;
        
        // Show loading indicator in file tree
        const fileTree = document.getElementById('file-tree');
        fileTree.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
                <div class="spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--text-muted); border-top: 2px solid var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 10px;"></div>
                <p>Discovering files...</p>
            </div>
        `;
        
        // Fetch repository tree to find all parquet files
        fetch(`https://api.github.com/repos/${repoPath}/git/trees/main?recursive=1`)
            .then(response => {
                console.log('[Analysis] GitHub API response status:', response.status);
                if (!response.ok) {
                    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('[Analysis] GitHub API data:', data);
                
                if (!data.tree || !Array.isArray(data.tree)) {
                    throw new Error('Invalid response from GitHub API - no tree data');
                }
                
                // Filter for parquet files in results directory
                const parquetFiles = data.tree
                    .filter(item => 
                        item.path.startsWith(resultsDir) && 
                        item.path.endsWith('.parquet') &&
                        item.path.includes('/plots/') &&
                        !item.path.includes('_log.parquet') &&
                        !item.path.includes('_log_tddr')
                    )
                    .map(item => {
                        const pathParts = item.path.split('/');
                        const participant = pathParts[1];
                        const filename = pathParts[pathParts.length - 1];
                        const displayName = filename
                            .replace('.parquet', '')
                            .replace(participant + '_', '')
                            .replace(/_/g, ' ')
                            .split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                            .join(' ');
                        
                        return {
                            path: item.path,
                            url: `https://raw.githubusercontent.com/${repoPath}/main/${item.path}`,
                            participant: participant,
                            filename: filename,
                            displayName: displayName,
                            size: item.size
                        };
                    });
                
                console.log('[Analysis] Found parquet files:', parquetFiles.length);
                
                // Group by participant
                const byParticipant = {};
                parquetFiles.forEach(file => {
                    if (!byParticipant[file.participant]) {
                        byParticipant[file.participant] = [];
                    }
                    byParticipant[file.participant].push(file);
                });
                
                console.log('[Analysis] Grouped by participant:', Object.keys(byParticipant));
                
                // Store data globally for search and display
                window.analysisData = {
                    repoName: firstPlot.repo_name,
                    byParticipant: byParticipant,
                    allFiles: parquetFiles
                };
                
                // Build hierarchical file tree (EmotiView style)
                buildAnalysisFileTree();
                
                // Initialize search
                const searchInput = document.getElementById('search-box');
                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        filterFileTree(e.target.value);
                    });
                }
            })
            .catch(error => {
                console.error('[Analysis] Error loading files:', error);
                fileTree.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                        <p>⚠️ Error loading files: ${error.message}</p>
                        <p style="font-size: 0.85em; margin-top: 10px;">Check browser console for details</p>
                    </div>
                `;
            });
        
        return; // Exit early for html_viewer types
    }
    
    // For other plot types (original sidebar-based interface)
    // Hide empty state and show download section
    emptyState.style.display = 'none';
    downloadSection.classList.add('visible');
    document.getElementById('download-all-btn').onclick = downloadAllData;
    
    // Build file tree
    buildFileTree();
    
    // Create a display for each plot
    plotsData.forEach((plotItem, index) => {
        // Skip html_viewer types - they're handled at the top level
        if (plotItem.plot_data && plotItem.plot_data.type === 'html_viewer') {
            return;
        }
        
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
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
                .replace(/\n\n/g, '</p><p>')
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
            
            // Handle AnalysisToolbox HTML viewers - fetch parquet files directly
            if (plotData.type === 'html_viewer') {
                const repoPath = plotItem.repo_name.includes('/') ? plotItem.repo_name : 'CGutt-hub/' + plotItem.repo_name;
                const resultsDir = plotData.results_dir;
                
                plotContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <p style="margin-bottom: 20px; color: var(--text-secondary);">
                            <span class="spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--text-muted); border-top: 2px solid var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></span>
                            Discovering analysis data from repository...
                        </p>
                    </div>
                `;
                
                // Fetch repository tree to find all parquet files
                fetch(`https://api.github.com/repos/${repoPath}/git/trees/main?recursive=1`)
                    .then(response => response.json())
                    .then(data => {
                        // Filter for parquet files in results directory
                        const parquetFiles = data.tree
                            .filter(item => 
                                item.path.startsWith(resultsDir) && 
                                item.path.endsWith('.parquet') &&
                                item.path.includes('/plots/') &&
                                !item.path.includes('_log.parquet') && // Skip raw log files
                                !item.path.includes('_log_tddr') // Skip TDDR intermediate files
                            )
                            .map(item => {
                                const pathParts = item.path.split('/');
                                const participant = pathParts[1]; // EV_002, EV_003, etc.
                                const filename = pathParts[pathParts.length - 1];
                                const displayName = filename
                                   .replace('.parquet', '')
                                    .replace(participant + '_', '')
                                    .replace(/_/g, ' ')
                                    .split(' ')
                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(' ');
                                
                                return {
                                    path: item.path,
                                    url: `https://raw.githubusercontent.com/${repoPath}/main/${item.path}`,
                                    participant: participant,
                                    displayName: displayName,
                                    size: item.size
                                };
                            });
                        
                        // Group by participant
                        const byParticipant = {};
                        parquetFiles.forEach(file => {
                            if (!byParticipant[file.participant]) {
                                byParticipant[file.participant] = [];
                            }
                            byParticipant[file.participant].push(file);
                        });
                        
                        // Render grouped files
                        const participantKeys = Object.keys(byParticipant).sort();
                        
                        plotContainer.innerHTML = `
                            <div style="padding: 20px;">
                                <div style="margin-bottom: 25px; text-align: center;">
                                    <h3 style="margin: 0 0 10px 0; color: var(--text-primary);">📊 Analysis Data</h3>
                                    <p style="margin: 0; color: var(--text-secondary); font-size: 0.95em;">
                                        Found <strong>${parquetFiles.length} plots</strong> across <strong>${participantKeys.length} participants</strong>
                                    </p>
                                </div>
                                
                                <div id="participants-container-${index}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                    ${participantKeys.map(participant => `
                                        <div style="background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 15px; cursor: pointer; transition: all 0.2s;" 
                                             onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.transform='translateY(-2px)';" 
                                             onmouseout="this.style.borderColor='var(--border-primary)'; this.style.transform='translateY(0)';"
                                             onclick="showParticipantPlots('${participant}', ${index})">
                                            <div style="font-weight: 600; font-size: 1.1em; margin-bottom: 8px; color: var(--text-primary);">
                                                ${participant}
                                            </div>
                                            <div style="color: var(--text-secondary); font-size: 0.9em;">
                                                ${byParticipant[participant].length} plots available
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <div id="plot-viewer-${index}" style="display: none;">
                                    <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-secondary); border-radius: 8px;">
                                        <button onclick="document.getElementById('plot-viewer-${index}').style.display='none'; document.getElementById('participants-container-${index}').style.display='grid';" 
                                                style="padding: 8px 16px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px; cursor: pointer; color: var(--text-primary); font-size: 0.9em;">
                                            ← Back to Participants
                                        </button>
                                        <span id="participant-name-${index}" style="margin-left: 15px; font-weight: 600; color: var(--text-primary);"></span>
                                    </div>
                                    
                                    <div id="plots-grid-${index}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; margin-bottom: 20px;">
                                    </div>
                                    
                                    <div id="plot-display-${index}" style="margin-top: 20px; padding: 20px; background: var(--bg-secondary); border-radius: 8px; display: none;">
                                        <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                                            <h4 id="plot-title-${index}" style="margin: 0; color: var(--text-primary);"></h4>
                                            <button onclick="document.getElementById('plot-display-${index}').style.display='none';" 
                                                    style="padding: 6px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 4px; cursor: pointer; color: var(--text-primary); font-size: 0.85em;">
                                                Close
                                            </button>
                                        </div>
                                        <div id="plot-chart-${index}"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        // Store data for later use
                        window[`parquetData_${index}`] = byParticipant;
                        
                        // Add helper functions if not already present
                        if (!window.showParticipantPlots) {
                            window.showParticipantPlots = function(participant, idx) {
                                const data = window[`parquetData_${idx}`][participant];
                                const plotsGrid = document.getElementById(`plots-grid-${idx}`);
                                const viewer = document.getElementById(`plot-viewer-${idx}`);
                                const container = document.getElementById(`participants-container-${idx}`);
                                const participantName = document.getElementById(`participant-name-${idx}`);
                                
                                container.style.display = 'none';
                                viewer.style.display = 'block';
                                participantName.textContent = participant;
                                
                                plotsGrid.innerHTML = data.map((file, fileIdx) => `
                                    <div style="background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px; padding: 12px; cursor: pointer; transition: all 0.2s;"
                                         onmouseover="this.style.borderColor='var(--accent-primary)'" 
                                         onmouseout="this.style.borderColor='var(--border-primary)'"
                                         onclick="loadAndDisplayPlot('${file.url}', '${file.displayName}', ${idx}, '${participant}')">
                                        <div style="font-weight: 600; font-size: 0.95em; margin-bottom: 6px; color: var(--text-primary);">
                                            ${file.displayName}
                                        </div>
                                        <div style="color: var(--text-muted); font-size: 0.8em;">
                                            ${(file.size / 1024).toFixed(1)} KB
                                        </div>
                                    </div>
                                `).join('');
                            };
                            
                            window.loadAndDisplayPlot = async function(url, displayName, idx, participant) {
                                const plotDisplay = document.getElementById(`plot-display-${idx}`);
                                const plotTitle = document.getElementById(`plot-title-${idx}`);
                                const plotChart = document.getElementById(`plot-chart-${idx}`);
                                
                                plotDisplay.style.display = 'block';
                                plotTitle.textContent = `${participant} - ${displayName}`;
                                plotChart.innerHTML = `
                                    <div style="text-align: center; padding: 40px;">
                                        <div class="spinner" style="margin: 0 auto 15px auto; width: 40px; height: 40px; border: 4px solid var(--bg-tertiary); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                        <p style="color: var(--text-secondary);">Loading and parsing parquet file...</p>
                                    </div>
                                `;
                                
                                try {
                                    const arrayBuffer = await fetchParquetData(url);
                                    const plotlyData = await parquetToPlotly(arrayBuffer, displayName);
                                    Plotly.newPlot(plotChart, plotlyData.data, plotlyData.layout, {responsive: true});
                                } catch (error) {
                                    plotChart.innerHTML = `
                                        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                                            <p>⚠️ Error loading plot: ${error.message}</p>
                                            <p style="font-size: 0.9em; margin-top: 10px;">This file might be too large or in an unsupported format.</p>
                                        </div>
                                    `;
                                }
                            };
                        }
                    })
                    .catch(error => {
                        plotContainer.innerHTML = `
                            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                                <p>⚠️ Error loading data: ${error.message}</p>
                            </div>
                        `;
                    });
            }
            // Handle parquet files - fetch and render directly
            else if (plotData.type === 'parquet') {
                plotContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <p style="margin-bottom: 20px; color: var(--text-secondary);">
                            Loading parquet file from repository...
                        </p>
                        <div class="spinner" style="margin: 20px auto; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                `;
                
                // Fetch and render parquet file
                fetchParquetData(plotItem.repo_name, plotItem.file_path)
                    .then(({ rows, arrayBuffer }) => {
                        const plotlyData = parquetToPlotly(rows);
                        
                        if (plotlyData) {
                            // Store arrayBuffer for download
                            plotContainer.dataset.parquetData = 'loaded';
                            plotContainer.parquetBuffer = arrayBuffer;
                            
                            // Render with Plotly
                            Plotly.newPlot(`plot-container-${index}`, plotlyData.data, plotlyData.layout, {responsive: true});
                        } else {
                            // Show data table if we can't auto-plot
                            const columns = Object.keys(rows[0]);
                            let tableHTML = `
                                <div style="padding: 20px; overflow: auto;">
                                    <p style="margin-bottom: 15px; color: var(--text-secondary);">
                                        <strong>${rows.length}</strong> rows × <strong>${columns.length}</strong> columns
                                    </p>
                                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                                        <thead>
                                            <tr style="background: var(--bg-secondary); border-bottom: 2px solid var(--border-primary);">
                                                ${columns.map(col => `<th style="padding: 8px; text-align: left;">${col}</th>`).join('')}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows.slice(0, 50).map(row => `
                                                <tr style="border-bottom: 1px solid var(--border-primary);">
                                                    ${columns.map(col => `<td style="padding: 8px;">${row[col]}</td>`).join('')}
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                    ${rows.length > 50 ? `<p style="margin-top: 10px; color: var(--text-secondary);">Showing first 50 rows...</p>` : ''}
                                </div>
                            `;
                            plotContainer.innerHTML = tableHTML;
                        }
                    })
                    .catch(error => {
                        plotContainer.innerHTML = `
                            <div style="padding: 20px; color: var(--text-secondary);">
                                <p style="color: red; margin-bottom: 10px;">⚠️ Error loading parquet file</p>
                                <p>${error.message}</p>
                                <p style="margin-top: 15px; font-size: 0.9em;">
                                    File path: <code>${plotItem.file_path}</code>
                                </p>
                            </div>
                        `;
                    });
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

// Build hierarchical file tree (EmotiView style) for html_viewer type
function buildAnalysisFileTree() {
    const fileTree = document.getElementById('file-tree');
    const  { repoName, byParticipant } = window.analysisData;
    
    const participantKeys = Object.keys(byParticipant).sort();
    
    // Build tree structure: Project > Participants > Files
    let html = `
        <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="true">
            <span class="tree-folder-icon">▶</span>
            <span>📁 ${repoName}</span>
        </div>
        <div class="tree-folder-content expanded" style="margin-left: 10px;">
    `;
    
    participantKeys.forEach(participant => {
        const files = byParticipant[participant];
        html += `
            <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
                <span class="tree-folder-icon">▶</span>
                <span>📂 ${participant}</span>
                <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${files.length})</span>
            </div>
            <div class="tree-folder-content" style="margin-left: 10px;">
        `;
        
        files.forEach(file => {
            html += `
                <div class="tree-item" onclick="loadPlotFile('${file.url}', '${file.displayName}', '${participant}')" data-filename="${file.filename.toLowerCase()}" data-display="${file.displayName.toLowerCase()}">
                    📊 ${file.displayName}
                    <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">
                        (${(file.size / 1024).toFixed(1)}KB)
                    </span>
                </div>
            `;
        });
        
        html += `
            </div>
        `;
    });
    
    html += `
        </div>
    `;
    
    fileTree.innerHTML = html;
}

// Toggle folder expand/collapse
function toggleFolder(element) {
    const icon = element.querySelector('.tree-folder-icon');
    const content = element.nextElementSibling;
    const isExpanded = element.dataset.expanded === 'true';
    
    if (isExpanded) {
        icon.style.transform = 'rotate(0deg)';
        content.classList.remove('expanded');
        element.dataset.expanded = 'false';
    } else {
        icon.style.transform = 'rotate(90deg)';
        content.classList.add('expanded');
        element.dataset.expanded = 'true';
    }
}

// Filter file tree based on search query
function filterFileTree(query) {
    const fileTree = document.getElementById('file-tree');
    const allItems = fileTree.querySelectorAll('.tree-item');
    const allFolders = fileTree.querySelectorAll('.tree-folder');
    
    if (!query || query.trim() === '') {
        // Show all items
        allItems.forEach(item => item.style.display = '');
        allFolders.forEach(folder => folder.style.display = '');
        return;
    }
    
    const searchLower = query.toLowerCase();
    
    // Filter items
    allItems.forEach(item => {
        const filename = item.dataset.filename || '';
        const display = item.dataset.display || '';
        const matches = filename.includes(searchLower) || display.includes(searchLower);
        item.style.display = matches ? '' : 'none';
    });
    
    // Show/hide folders based on visible children
    allFolders.forEach(folder => {
        const content = folder.nextElementSibling;
        if (content && content.classList.contains('tree-folder-content')) {
            const visibleChildren = Array.from(content.querySelectorAll('.tree-item'))
                .filter(item => item.style.display !== 'none');
            
            if (visibleChildren.length > 0) {
                folder.style.display = '';
                // Auto-expand folders with matches
                folder.dataset.expanded = 'true';
                content.classList.add('expanded');
                const icon = folder.querySelector('.tree-folder-icon');
                if (icon) icon.style.transform = 'rotate(90deg)';
            } else {
                folder.style.display = 'none';
            }
        }
    });
}

// Load and display a plot file when clicked
async function loadPlotFile(url, displayName, participant) {
    const emptyState = document.getElementById('empty-state');
    const plotDisplays = document.getElementById('plot-displays');
    
    // Remove previous active states
    document.querySelectorAll('.tree-item.active').forEach(item => {
        item.classList.remove('active');
    });
    
    // Mark clicked item as active
    event.target.closest('.tree-item').classList.add('active');
    
    // Hide empty state
    emptyState.style.display = 'none';
    
    // Create plot display
    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot">
            <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid var(--border-primary, #ddd);">
                <h2 style="margin: 0 0 10px 0; color: var(--text-primary, #333); font-size: 1.5rem;">
                    ${participant} — ${displayName}
                </h2>
                <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                    <button onclick="exportPlotAsPNG('current-plot-chart')" 
                            style="padding: 6px 14px; background: var(--bg-secondary, #f0f0f0); border: 1px solid var(--border-primary, #ddd); border-radius: 5px; cursor: pointer; font-size: 0.85rem; font-family: var(--font-mono, monospace); transition: all 0.2s;">
                        📸 PNG
                    </button>
                    <button onclick="exportPlotAsSVG('current-plot-chart')" 
                            style="padding: 6px 14px; background: var(--bg-secondary, #f0f0f0); border: 1px solid var(--border-primary, #ddd); border-radius: 5px; cursor: pointer; font-size: 0.85rem; font-family: var(--font-mono, monospace); transition: all 0.2s;">
                        🎨 SVG
                    </button>
                    <button onclick="exportPlotAsPDF('current-plot-chart', '${participant}', '${displayName}')" 
                            style="padding: 6px 14px; background: var(--bg-secondary, #f0f0f0); border: 1px solid var(--border-primary, #ddd); border-radius: 5px; cursor: pointer; font-size: 0.85rem; font-family: var(--font-mono, monospace); transition: all 0.2s;">
                        📄 PDF
                    </button>
                    <span style="color: var(--text-muted, #999); font-size: 0.85rem; margin-left: auto;">
                        Loading from GitHub...
                    </span>
                </div>
            </div>
            <div id="current-plot-chart" style="width: 100%; height: calc(100vh - 300px); min-height: 500px;background: var(--bg-secondary, #f8f8f8); border: 1px solid var(--border-primary, #ddd); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 15px;">
                    <div class="spinner" style="width: 50px; height: 50px; border: 5px solid var(--bg-tertiary, #ddd); border-top: 5px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="color: var(--text-secondary, #666); font-size: 0.95rem;">Fetching and parsing parquet file...</p>
                </div>
            </div>
        </div>
    `;
    
    try {
        const arrayBuffer = await fetchParquetData(url);
        const plotlyData = await parquetToPlotly(arrayBuffer, displayName);
        
        const chartDiv = document.getElementById('current-plot-chart');
        Plotly.newPlot(chartDiv, plotlyData.data, plotlyData.layout, {responsive: true});
        
        // Update status
        const statusSpan = document.querySelector('#current-plot span[style*="margin-left: auto"]');
        if (statusSpan) {
            statusSpan.textContent = '✅ Loaded successfully';
        }
    } catch (error) {
        const chartDiv = document.getElementById('current-plot-chart');
        chartDiv.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; padding: 40px; text-align: center;">
                <p style="color: var(--text-secondary, #666); font-size: 1.1rem; margin-bottom: 10px;">⚠️ Error loading plot</p>
                <p style="color: var(--text-muted, #999); font-size: 0.9rem;">${error.message}</p>
                <p style="color: var(--text-muted, #999); font-size: 0.85rem; margin-top: 15px;">
                    This file might be too large, corrupted, or in an unsupported format.
                </p>
            </div>
        `;
    }
}

// Export functions for plot downloads
function exportPlotAsPNG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        Plotly.downloadImage(plotDiv, {
            format: 'png',
            width: 1920,
            height: 1080,
            filename: 'analysis_plot'
        });
    }
}

function exportPlotAsSVG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        Plotly.downloadImage(plotDiv, {
            format: 'svg',
            filename: 'analysis_plot'
        });
    }
}

function exportPlotAsPDF(plotId, participant, displayName) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        const filename = `${participant}_${displayName.replace(/\s+/g, '_')}`;
        Plotly.downloadImage(plotDiv, {
            format: 'pdf',
            width: 1920,
            height: 1080,
            filename: filename
        });
    }
}

// Initialize page: data is already loaded via window.plotsData
function initAnalysisPage() {
    // Check if data was embedded at build time
    if (typeof window.plotsData === 'undefined') {
        console.error('Plot data not found - was it embedded at build time?');
        const emptyState = document.getElementById('empty-state');
        emptyState.innerHTML = `
            <h2>⚠️ Error Loading Data</h2>
            <p>Analysis data was not embedded during site build.</p>
            <p style="color: var(--text-secondary); font-size: 0.9em;">Please rebuild the site with fetch_data.py</p>
        `;
        return;
    }
    
    plotsData = window.plotsData;
    renderPlots();
}

// Start when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalysisPage);
} else {
    initAnalysisPage();
}
