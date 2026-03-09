// Open Data Analysis Page JavaScript
// Handles plot rendering, PDF generation, and data downloads

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
