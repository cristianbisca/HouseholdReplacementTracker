// ============================================
// Household Replacement Tracker - Frontend App
// Vanilla JS with WebSocket real-time sync
// ============================================

(function() {
  'use strict';

  // --- State Management ---
  const state = {
    items: [],
    filteredItems: [],
    currentFilter: 'all',
    currentView: 'list',
    selectedItem: null,
    currentUser: localStorage.getItem('hrt_user') || '',
    users: JSON.parse(localStorage.getItem('hrt_users') || '[]'),
    ws: null,
    wsConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    settings: {}
  };

  // --- DOM References ---
  const dom = {};

  function cacheDOMElements() {
    dom.itemsGrid = document.getElementById('itemsGrid');
    dom.emptyState = document.getElementById('emptyState');
    dom.itemsView = document.getElementById('itemsView');
    dom.detailView = document.getElementById('detailView');
    dom.filterNav = document.getElementById('filterNav');
    dom.connectionStatus = document.getElementById('connectionStatus');
    dom.addNewItemBtn = document.getElementById('addNewItemBtn');
    dom.backBtn = document.getElementById('backBtn');
    dom.currentUserSelect = document.getElementById('currentUserSelect');
    dom.addUserBtn = document.getElementById('addUserBtn');
    dom.toastContainer = document.getElementById('toastContainer');

    // Modals
    dom.itemModal = document.getElementById('itemModal');
    dom.replacementModal = document.getElementById('replacementModal');
    dom.usageModal = document.getElementById('usageModal');
    dom.userModal = document.getElementById('userModal');

    // Forms
    dom.itemForm = document.getElementById('itemForm');
    dom.replacementForm = document.getElementById('replacementForm');
    dom.usageForm = document.getElementById('usageForm');
    dom.userForm = document.getElementById('userForm');

    // Detail view elements
    dom.detailHeader = document.getElementById('detailHeader');
    dom.detailStatusCard = document.getElementById('detailStatusCard');
    dom.detailActions = document.getElementById('detailActions');
    dom.detailInfoGrid = document.getElementById('detailInfoGrid');
    dom.partSection = document.getElementById('partSection');
    dom.partInfoGrid = document.getElementById('partInfoGrid');
    dom.historySection = document.getElementById('historySection');
    dom.historyList = document.getElementById('historyList');
    dom.editItemBtn = document.getElementById('editItemBtn');
    dom.deleteItemBtn = document.getElementById('deleteItemBtn');
  }

  // --- API Helper Functions ---
  async function apiRequest(method, path, body = null) {
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(path, options);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'API request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      showToast(error.message, 'error');
      throw error;
    }
  }

  async function loadItems() {
    try {
      const result = await apiRequest('GET', '/api/items');
      state.items = result.data;
      applyFilter();
      renderItems();
    } catch (error) {
      console.error('Failed to load items:', error);
    }
  }

  async function loadSettings() {
    try {
      const result = await apiRequest('GET', '/api/settings');
      state.settings = result.data;
      document.getElementById('appSubtitle').textContent = result.data.app_name || 'Household Replacement Tracker';
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  // --- WebSocket Connection ---
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?user=${encodeURIComponent(state.currentUser)}`;
    
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      console.log('WebSocket connected');
      state.wsConnected = true;
      state.reconnectAttempts = 0;
      updateConnectionStatus(true);
    };

    state.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code);
      state.wsConnected = false;
      updateConnectionStatus(false);
      
      // Attempt reconnection with exponential backoff
      if (state.reconnectAttempts < state.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
        setTimeout(() => {
          state.reconnectAttempts++;
          connectWebSocket();
        }, delay);
      }
    };

    state.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    state.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
  }

  function handleWebSocketMessage(message) {
    switch (message.type) {
      case 'state_update':
        state.items = message.payload.items || [];
        applyFilter();
        renderItems();
        break;

      case 'item_created':
        state.items.push(message.payload.item);
        applyFilter();
        renderItems();
        showToast('Item added', 'success');
        break;

      case 'item_updated':
        updateItemInState(message.payload.item);
        applyFilter();
        renderItems();
        if (state.selectedItem && state.selectedItem.id === message.payload.item.id) {
          showDetailView(message.payload.item.id);
        }
        break;

      case 'item_deleted':
        state.items = state.items.filter(i => i.id !== message.payload.id);
        applyFilter();
        renderItems();
        if (state.selectedItem && state.selectedItem.id === message.payload.id) {
          showListView();
        }
        showToast('Item removed', 'success');
        break;

      case 'replacement_recorded':
        updateItemInState(message.payload.item);
        applyFilter();
        renderItems();
        if (state.selectedItem && state.selectedItem.id === message.payload.item.id) {
          showDetailView(message.payload.item.id);
        }
        showToast(`Replacement recorded for ${message.payload.item.name}`, 'success');
        break;

      case 'usage_incremented':
        updateItemInState(message.payload.item);
        applyFilter();
        renderItems();
        if (state.selectedItem && state.selectedItem.id === message.payload.item.id) {
          showDetailView(message.payload.item.id);
        }
        break;

      case 'client_disconnected':
        // Update connected clients count if needed
        break;
    }
  }

  function updateItemInState(item) {
    const index = state.items.findIndex(i => i.id === item.id);
    if (index !== -1) {
      state.items[index] = item;
    } else {
      state.items.push(item);
    }
  }

  function updateConnectionStatus(connected) {
    const statusDot = dom.connectionStatus.querySelector('.status-dot');
    const statusText = dom.connectionStatus.querySelector('.status-text');
    
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Reconnecting...';
    }
  }

  // --- Filter Logic ---
  function applyFilter() {
    switch (state.currentFilter) {
      case 'overdue':
        state.filteredItems = state.items.filter(i => i.is_overdue);
        break;
      case 'due-soon':
        state.filteredItems = state.items.filter(i => 
          !i.is_overdue && i.days_until_due !== null && i.days_until_due <= 7
        );
        break;
      case 'usage':
        state.filteredItems = state.items.filter(i => i.usage_enabled);
        break;
      default:
        state.filteredItems = [...state.items];
    }

    // Sort by due date (most urgent first)
    state.filteredItems.sort((a, b) => {
      // Items without next_due_date go to the bottom
      if (!a.next_due_date && !b.next_due_date) return 0;
      if (!a.next_due_date) return 1;
      if (!b.next_due_date) return -1;

      // Compare by days_until_due (ascending, most urgent first)
      const daysA = a.days_until_due ?? Infinity;
      const daysB = b.days_until_due ?? Infinity;
      return daysA - daysB;
    });
  }

  // --- Rendering Functions ---
  function renderItems() {
    if (state.filteredItems.length === 0) {
      dom.itemsGrid.style.display = 'none';
      dom.emptyState.style.display = 'block';
      return;
    }

    dom.itemsGrid.style.display = 'grid';
    dom.emptyState.style.display = 'none';

    dom.itemsGrid.innerHTML = state.filteredItems.map(item => renderItemCard(item)).join('');
  }

  function renderItemCard(item) {
    const statusInfo = getItemStatus(item);
    
    let cardContent = `
      <div class="card-header">
        <span class="card-title">${escapeHtml(item.name)}</span>
        ${item.category ? `<span class="card-category">${escapeHtml(item.category)}</span>` : ''}
      </div>
    `;

    if (item.description) {
      cardContent += `<div class="card-description">${escapeHtml(item.description)}</div>`;
    }

    // Status display
    cardContent += '<div class="card-status">';
    
    if (item.usage_enabled && item.usage_interval_value) {
      const pct = item.usage_percentage || 0;
      const current = item.current_usage_count || 0;
      const target = item.usage_interval_value;
      cardContent += `
        <span class="status-badge usage">${Math.round(current)}/${target} ${escapeHtml(item.usage_unit || 'units')}</span>
      `;
      
      // Progress bar
      cardContent += `
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${getProgressClass(pct)}" style="width: ${pct}%"></div>
          </div>
          <div class="progress-label">
            <span>${Math.round(pct)}% used</span>
            <span>${formatDate(item.last_reset_date)}</span>
          </div>
        </div>
      `;
    } else if (item.next_due_date) {
      cardContent += `<span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>`;
    }

    cardContent += '</div>';

    // Date tags row (last replaced & next due)
    if (item.last_replaced_date || item.next_due_date) {
      cardContent += '<div class="card-date-tags">';
      if (item.last_replaced_date) {
        cardContent += `<span class="date-tag"><span class="date-tag-label">Last replaced</span> <span class="date-tag-value">${formatDate(item.last_replaced_date)}</span></span>`;
      }
      if (item.next_due_date) {
        cardContent += `<span class="date-tag"><span class="date-tag-label">Next due</span> <span class="date-tag-value">${formatDate(item.next_due_date)}</span></span>`;
      }
      cardContent += '</div>';
    }

    // Action buttons
    cardContent += '<div class="card-actions">';
    
    if (item.usage_enabled && item.usage_interval_value) {
      cardContent += `<button class="usage-add-btn" data-item-id="${item.id}" onclick="event.stopPropagation(); openUsageModal('${item.id}')">+ Add Usage</button>`;
    }
    
    cardContent += `<button class="replace-btn" data-item-id="${item.id}" onclick="event.stopPropagation(); openReplacementModal('${item.id}')">✓ Replaced Today</button>`;
    cardContent += '</div>';

    return `
      <div class="item-card ${statusInfo.cardClass}" data-item-id="${item.id}" onclick="showDetailView('${item.id}')">
        ${cardContent}
      </div>
    `;
  }

  function getItemStatus(item) {
    if (item.usage_enabled && item.usage_interval_value) {
      const pct = item.usage_percentage || 0;
      if (pct >= 100) return { text: 'Needs Reset', class: 'overdue', cardClass: 'status-overdue' };
      if (pct >= 80) return { text: `${Math.round(pct)}% used`, class: 'usage', cardClass: 'status-usage' };
      return { text: `${Math.round(pct)}% used`, class: 'usage', cardClass: 'status-ok' };
    }

    if (!item.next_due_date) {
      return { text: 'No due date', class: 'warning', cardClass: 'status-warning' };
    }

    const days = item.days_until_due;
    
    if (days < 0) {
      return { 
        text: `${Math.abs(days)}d overdue`, 
        class: 'overdue', 
        cardClass: 'status-overdue' 
      };
    } else if (days === 0) {
      return { text: 'Due today', class: 'warning', cardClass: 'status-warning' };
    } else if (days <= 7) {
      return { text: `${days}d remaining`, class: 'warning', cardClass: 'status-warning' };
    } else {
      return { text: `${days}d remaining`, class: 'ok', cardClass: 'status-ok' };
    }
  }

  function getProgressClass(pct) {
    if (pct < 30) return 'low';
    if (pct < 60) return 'medium';
    if (pct < 90) return 'high';
    return 'critical';
  }

  // --- Detail View ---
  async function showDetailView(itemId) {
    state.selectedItem = state.items.find(i => i.id === itemId);
    
    if (!state.selectedItem) {
      await loadSingleItem(itemId);
    }

    const item = state.selectedItem;
    if (!item) return;

    // Switch views
    dom.itemsView.classList.remove('active');
    dom.detailView.classList.add('active');

    // Render header
    dom.detailHeader.innerHTML = `
      <h1 class="detail-title">${escapeHtml(item.name)}</h1>
      ${item.category ? `<span class="detail-category">${escapeHtml(item.category)}</span>` : ''}
    `;

    // Render status card
    const statusInfo = getItemStatus(item);
    let statusHTML = '';

    if (item.usage_enabled && item.usage_interval_value) {
      const pct = item.usage_percentage || 0;
      const current = item.current_usage_count || 0;
      const target = item.usage_interval_value;
      const remaining = Math.max(0, target - current);
      
      statusHTML += `
        <div class="status-row">
          <span class="status-label">Usage Progress</span>
          <span class="status-value">${Math.round(current)} / ${target} ${escapeHtml(item.usage_unit || 'units')}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Percentage Used</span>
          <span class="status-value">${Math.round(pct)}%</span>
        </div>
        <div class="status-row">
          <span class="status-label">Remaining</span>
          <span class="status-value">${Math.round(remaining)} ${escapeHtml(item.usage_unit || 'units')}</span>
        </div>
      `;
    }

    if (item.next_due_date) {
      statusHTML += `
        <div class="status-row">
          <span class="status-label">Next Due</span>
          <span class="status-value">${formatDate(item.next_due_date)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Status</span>
          <span class="status-value"><span class="status-badge ${statusInfo.class}">${statusInfo.text}</span></span>
        </div>
      `;
    }

    if (item.last_replaced_date) {
      statusHTML += `
        <div class="status-row">
          <span class="status-label">Last Replaced</span>
          <span class="status-value">${formatDate(item.last_replaced_date)}</span>
        </div>
      `;
    }

    dom.detailStatusCard.innerHTML = statusHTML || '<p>No tracking data yet.</p>';

    // Render action buttons
    let actionsHTML = '';
    
    if (item.usage_enabled && item.usage_interval_value) {
      actionsHTML += `<button class="btn btn-primary" onclick="openUsageModal('${item.id}')">+ Add Usage</button>`;
    }
    
    actionsHTML += `<button class="btn btn-success" onclick="openReplacementModal('${item.id}')">✓ Replaced Today</button>`;
    dom.detailActions.innerHTML = actionsHTML;

    // Render details info
    let infoHTML = '';
    
    if (item.description) {
      infoHTML += createInfoItem('Description', item.description);
    }

    if (item.time_interval_type && item.time_interval_value) {
      infoHTML += createInfoItem('Replacement Interval', `Every ${item.time_interval_value} ${item.time_interval_type}`);
    }

    dom.detailInfoGrid.innerHTML = infoHTML || '<p class="text-muted">No additional details.</p>';

    // Render part information
    const hasPartInfo = item.part_number || item.manufacturer || item.specifications || item.reorder_url;
    dom.partSection.style.display = hasPartInfo ? 'block' : 'none';

    let partHTML = '';
    
    if (item.part_number) {
      partHTML += createInfoItem('Part Number', item.part_number);
    }
    
    if (item.manufacturer) {
      partHTML += createInfoItem('Manufacturer', item.manufacturer);
    }
    
    if (item.specifications) {
      partHTML += createInfoItem('Specifications', item.specifications);
    }
    
    if (item.reorder_url) {
      partHTML += createInfoItem('Reorder Link', `<a href="${escapeHtml(item.reorder_url)}" target="_blank" rel="noopener">Open Reorder Link →</a>`);
    }

    dom.partInfoGrid.innerHTML = partHTML;

    // Load and render history
    await loadHistory(item.id);
  }

  async function loadSingleItem(itemId) {
    try {
      const result = await apiRequest('GET', `/api/items/${itemId}`);
      state.selectedItem = result.data;
    } catch (error) {
      console.error('Failed to load item:', error);
    }
  }

  async function loadHistory(itemId) {
    try {
      const result = await apiRequest('GET', `/api/items/${itemId}/history`);
      renderHistory(result.data);
    } catch (error) {
      console.error('Failed to load history:', error);
      dom.historyList.innerHTML = '<p class="history-empty">Failed to load history</p>';
    }
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      dom.historyList.innerHTML = '<p class="history-empty">No replacement history yet.</p>';
      return;
    }

    dom.historyList.innerHTML = history.map(entry => `
      <div class="history-item">
        <div>
          <div class="history-date">${formatDate(entry.replaced_date)}</div>
          ${entry.notes ? `<div class="history-notes">${escapeHtml(entry.notes)}</div>` : ''}
        </div>
        ${entry.replaced_by ? `<span class="card-category">${escapeHtml(entry.replaced_by)}</span>` : ''}
      </div>
    `).join('');
  }

  function showListView() {
    dom.detailView.classList.remove('active');
    dom.itemsView.classList.add('active');
    state.selectedItem = null;
  }

  // --- Modal Functions ---
  window.openModal = function(modalId) {
    document.getElementById(modalId).classList.add('active');
  };

  function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  function openReplacementModal(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('replacementItemId').value = itemId;
    document.getElementById('confirmationText').textContent = 
      `Confirm that you replaced "${item.name}" today?`;
    document.getElementById('replacementNotes').value = '';
    
    openModal('replacementModal');
  }

  function openUsageModal(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('usageItemId').value = itemId;
    document.getElementById('usageConfirmationText').textContent = 
      `Add usage for "${item.name}" (Current: ${Math.round(item.current_usage_count || 0)} / ${item.usage_interval_value} ${item.usage_unit || 'units'})`;
    document.getElementById('usageAmount').value = 1;
    
    openModal('usageModal');
  }

  function openItemModal(editId = null) {
    // Reset form
    dom.itemForm.reset();
    document.getElementById('editItemId').value = '';
    document.getElementById('itemUsageEnabled').checked = false;
    document.getElementById('usageFields').style.display = 'none';
    document.getElementById('itemIntervalValue').value = state.settings.default_time_interval_value || 6;

    if (editId) {
      const item = state.items.find(i => i.id === editId);
      if (!item) return;

      document.getElementById('itemModalTitle').textContent = 'Edit Item';
      document.getElementById('saveItemBtn').textContent = 'Update Item';
      document.getElementById('editItemId').value = item.id;
      
      // Populate form
      document.getElementById('itemName').value = item.name || '';
      document.getElementById('itemCategory').value = item.category || '';
      document.getElementById('itemDescription').value = item.description || '';
      document.getElementById('itemIntervalType').value = item.time_interval_type || 'months';
      document.getElementById('itemIntervalValue').value = item.time_interval_value || 1;
      document.getElementById('itemLastReplaced').value = item.last_replaced_date || '';
      document.getElementById('itemNextDue').value = item.next_due_date || '';
      
      // Usage fields
      document.getElementById('itemUsageEnabled').checked = !!item.usage_enabled;
      if (item.usage_enabled) {
        document.getElementById('usageFields').style.display = 'block';
        document.getElementById('itemUsageInterval').value = item.usage_interval_value || 0;
        document.getElementById('itemUsageUnit').value = item.usage_unit || '';
        document.getElementById('itemCurrentUsage').value = item.current_usage_count || 0;
      }
      
      // Part info
      document.getElementById('itemPartNumber').value = item.part_number || '';
      document.getElementById('itemManufacturer').value = item.manufacturer || '';
      document.getElementById('itemSpecifications').value = item.specifications || '';
      document.getElementById('itemReorderUrl').value = item.reorder_url || '';
      
      // Notes
      document.getElementById('itemNotes').value = item.notes || '';
    } else {
      document.getElementById('itemModalTitle').textContent = 'Add New Item';
      document.getElementById('saveItemBtn').textContent = 'Save Item';
    }

    openModal('itemModal');
  }

  // --- Event Handlers ---
  function setupEventListeners() {
    // Filter tabs
    dom.filterNav.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-tab')) {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        state.currentFilter = e.target.dataset.filter;
        applyFilter();
        renderItems();
      }
    });

    // Add new item button
    dom.addNewItemBtn.addEventListener('click', () => openItemModal());

    // Back button
    dom.backBtn.addEventListener('click', showListView);

    // Modal close buttons
    document.querySelectorAll('.modal-close, [data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal || btn.dataset.modalClose;
        closeModal(modalId);
      });
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Usage enabled checkbox toggle
    document.getElementById('itemUsageEnabled').addEventListener('change', (e) => {
      document.getElementById('usageFields').style.display = e.target.checked ? 'block' : 'none';
    });

    // Item form submit
    dom.itemForm.addEventListener('submit', handleItemSubmit);

    // Replacement form submit
    dom.replacementForm.addEventListener('submit', handleReplacementSubmit);

    // Usage form submit
    dom.usageForm.addEventListener('submit', handleUsageSubmit);

    // User form submit
    dom.userForm.addEventListener('submit', handleUserSubmit);

    // Edit item button
    dom.editItemBtn.addEventListener('click', () => {
      if (state.selectedItem) {
        const itemId = state.selectedItem.id;
        showListView();
        setTimeout(() => openItemModal(itemId), 100);
      }
    });

    // Delete item button
    dom.deleteItemBtn.addEventListener('click', handleDeleteItem);

    // User selection change
    dom.currentUserSelect.addEventListener('change', (e) => {
      state.currentUser = e.target.value;
      localStorage.setItem('hrt_user', state.currentUser);
      // Reconnect WebSocket with new user
      if (state.ws) {
        state.ws.close();
        connectWebSocket();
      }
    });

    // Add user button
    dom.addUserBtn.addEventListener('click', () => {
      document.getElementById('userName').value = '';
      openModal('userModal');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      }
      if (e.key === 'n' && !e.target.closest('input, textarea, select')) {
        openItemModal();
      }
    });
  }

  async function handleItemSubmit(e) {
    e.preventDefault();

    const editId = document.getElementById('editItemId').value;
    const formData = {
      name: document.getElementById('itemName').value.trim(),
      category: document.getElementById('itemCategory').value,
      description: document.getElementById('itemDescription').value.trim(),
      time_interval_type: document.getElementById('itemIntervalType').value,
      time_interval_value: parseInt(document.getElementById('itemIntervalValue').value) || 1,
      last_replaced_date: document.getElementById('itemLastReplaced').value || null,
      next_due_date: document.getElementById('itemNextDue').value || null,
      usage_enabled: document.getElementById('itemUsageEnabled').checked,
      usage_interval_value: parseInt(document.getElementById('itemUsageInterval').value) || 0,
      usage_unit: document.getElementById('itemUsageUnit').value.trim(),
      current_usage_count: parseFloat(document.getElementById('itemCurrentUsage').value) || 0,
      part_number: document.getElementById('itemPartNumber').value.trim(),
      manufacturer: document.getElementById('itemManufacturer').value.trim(),
      specifications: document.getElementById('itemSpecifications').value.trim(),
      reorder_url: document.getElementById('itemReorderUrl').value.trim(),
      notes: document.getElementById('itemNotes').value.trim()
    };

    try {
      if (editId) {
        await apiRequest('PUT', `/api/items/${editId}`, formData);
        showToast('Item updated successfully', 'success');
      } else {
        await apiRequest('POST', '/api/items', formData);
        showToast('Item added successfully', 'success');
      }

      closeModal('itemModal');
      
      if (editId) {
        // Refresh and stay on detail view
        await loadItems();
        showDetailView(editId);
      } else {
        await loadItems();
      }
    } catch (error) {
      console.error('Failed to save item:', error);
    }
  }

  async function handleReplacementSubmit(e) {
    e.preventDefault();

    const itemId = document.getElementById('replacementItemId').value;
    const notes = document.getElementById('replacementNotes').value.trim();

    try {
      await apiRequest('POST', `/api/items/${itemId}/replace`, {
        notes,
        replaced_by: state.currentUser
      });

      closeModal('replacementModal');
      
      // Refresh current view
      if (state.selectedItem && state.selectedItem.id === itemId) {
        showDetailView(itemId);
      } else {
        await loadItems();
      }
    } catch (error) {
      console.error('Failed to record replacement:', error);
    }
  }

  async function handleUsageSubmit(e) {
    e.preventDefault();

    const itemId = document.getElementById('usageItemId').value;
    const amount = parseInt(document.getElementById('usageAmount').value) || 1;

    try {
      await apiRequest('POST', `/api/items/${itemId}/usage`, { amount });

      closeModal('usageModal');
      
      // Refresh current view
      if (state.selectedItem && state.selectedItem.id === itemId) {
        showDetailView(itemId);
      } else {
        await loadItems();
      }
    } catch (error) {
      console.error('Failed to add usage:', error);
    }
  }

  async function handleDeleteItem() {
    if (!state.selectedItem) return;

    const confirmed = confirm(`Are you sure you want to delete "${state.selectedItem.name}"?`);
    if (!confirmed) return;

    try {
      await apiRequest('DELETE', `/api/items/${state.selectedItem.id}`);
      showToast('Item deleted', 'success');
      showListView();
      await loadItems();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  }

  function handleUserSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('userName').value.trim();
    if (!name) return;

    // Check if user already exists
    if (state.users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
      showToast('User already exists', 'warning');
      return;
    }

    const colors = ['#2563eb', '#16a34a', '#ea580c', '#dc2626', '#7c3aed', '#0891b2', '#be185d'];
    const user = {
      id: Date.now().toString(36),
      name,
      color: colors[state.users.length % colors.length]
    };

    state.users.push(user);
    localStorage.setItem('hrt_users', JSON.stringify(state.users));

    // Add to select
    const option = document.createElement('option');
    option.value = user.name;
    option.textContent = user.name;
    dom.currentUserSelect.appendChild(option);

    closeModal('userModal');
    showToast(`${name} added`, 'success');
  }

  function renderUserSelect() {
    // Clear existing options except the first one
    while (dom.currentUserSelect.options.length > 1) {
      dom.currentUserSelect.remove(1);
    }

    state.users.forEach(user => {
      const option = document.createElement('option');
      option.value = user.name;
      option.textContent = user.name;
      if (user.name === state.currentUser) {
        option.selected = true;
      }
      dom.currentUserSelect.appendChild(option);
    });
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 250ms ease';
      
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // --- Utility Functions ---
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (e) {
      return dateStr;
    }
  }

  function createInfoItem(label, value) {
    return `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value">${value}</div>
      </div>
    `;
  }

  // --- Initialization ---
  function init() {
    cacheDOMElements();
    setupEventListeners();
    renderUserSelect();
    
    // Load data
    loadSettings();
    loadItems();
    
    // Connect WebSocket
    connectWebSocket();
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose necessary functions globally for inline event handlers
  window.openModal = openModal;
  window.showDetailView = showDetailView;
  window.openReplacementModal = openReplacementModal;
  window.openUsageModal = openUsageModal;

})();