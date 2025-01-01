let map;
let activePopup = null;
let addressData = {
    addresses: []
};
let stopIcon;
const visibleColors = new Set(['red', 'orange', 'yellow', 'green', 'grey', 'blue']);
let markers = [];

// Initialize the map and load data
async function initMap() {
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Auburndale Baptist Church',
        maxZoom: 20
    }).addTo(map);

    // Create stop icon
    stopIcon = L.divIcon({
        html: '<i class="fas fa-stop-sign" style="color: red; font-size: 24px;"></i>',
        iconSize: [24, 24],
        className: 'stop-icon'
    });

    // Get user's location and set view
    if ("geolocation" in navigator) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject);
            });
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 18);
        } catch (error) {
            console.log("Location access denied, using default location");
            // Default to 5590 Bruce Avenue, Louisville KY 40214
            map.setView([38.144212, -85.777914], 18);
        }
    } else {
        map.setView([38.144212, -85.777914], 18);
    }

    // Add click handler to map
    map.on('click', function(e) {
        if (e.originalEvent._stopped) return;
        markers.forEach(m => {
            m.leafletMarker._clicked = false;
            if (m.leafletMarker.isPopupOpen()) {
                m.leafletMarker.closePopup();
            }
        });
        onMapClick(e);
    });

    await loadAddressData();
    setupAutocomplete();
    displayExistingPins();
}

// Load address data from Firebase
async function loadAddressData() {
    showLoading();
    try {
        const querySnapshot = await window.getDocs(window.collection(window.db, 'addresses'));
        addressData.addresses = [];
        
        // Clear existing markers
        markers.forEach(marker => {
            map.removeLayer(marker.leafletMarker);
        });
        markers = [];
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const addressWithId = { id: doc.id, ...data };
            addressData.addresses.push(addressWithId);
            
            // Create pin immediately if coordinates exist
            if (data.coordinates) {
                createPin(data.coordinates, addressWithId);
            }
        });

    } catch (error) {
        console.error('Error loading address data:', error);
    } finally {
        hideLoading();
    }
}

// Save address data to Firebase
async function saveAddressData(newAddress) {
    try {
        // Ensure we have a history array
        const history = newAddress.history || [{
            timestamp: Date.now(),
            firstName: newAddress.firstName,
            lastName: newAddress.lastName,
            results: newAddress.results,
            visitedBy: newAddress.visitedBy,
            comment: newAddress.comments
        }];

        // Get the most recent entry
        const mostRecent = history[history.length - 1];

        const coordinates = newAddress.coordinates || await getCoordinates(formatAddress(newAddress));
        const docData = {
            houseNumber: newAddress.houseNumber,
            streetName: newAddress.streetName,
            city: newAddress.city,
            state: newAddress.state,
            zip: newAddress.zip,
            coordinates: coordinates || null,
            updatedAt: Date.now(),
            // Store the current/most recent values at the top level for querying
            results: mostRecent.results,
            firstName: mostRecent.firstName,
            lastName: mostRecent.lastName,
            visitedBy: mostRecent.visitedBy,
            history: history
        };

        const docRef = await window.addDoc(window.collection(window.db, 'addresses'), docData);
        const addressWithId = { ...docData, id: docRef.id };
        addressData.addresses.push(addressWithId);
        return docRef;
    } catch (error) {
        console.error('Error saving address data:', error);
        throw error;
    }
}

// Setup autocomplete for all fields
function setupAutocomplete() {
    const fields = ['streetName', 'city', 'state', 'zip', 'feedback'];
    fields.forEach(field => {
        const input = document.getElementById(field);
        const suggestions = document.getElementById(`${field}Suggestions`);
        
        // Skip if elements don't exist
        if (!input || !suggestions) return;

        input.addEventListener('input', () => {
            const value = input.value.toLowerCase();
            const uniqueValues = [...new Set(addressData.addresses.map(addr => addr[field]))];
            const matches = uniqueValues.filter(val => 
                val && val.toLowerCase().includes(value)
            );

            suggestions.innerHTML = '';
            matches.forEach(match => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = match;
                div.onclick = () => {
                    input.value = match;
                    suggestions.style.display = 'none';
                };
                suggestions.appendChild(div);
            });
            suggestions.style.display = matches.length ? 'block' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target)) {
                suggestions.style.display = 'none';
            }
        });
    });
}

// Display existing pins from data
async function displayExistingPins() {
    console.log('Displaying pins for addresses:', addressData.addresses);
    for (const address of addressData.addresses) {
        if (address.coordinates) {
            // Use stored coordinates if available
            createPin(address.coordinates, address);
        } else {
            // If no coordinates, geocode and update the record
            try {
                const coordinates = await getCoordinates(formatAddress(address));
                if (coordinates) {
                    // Update Firebase document with coordinates
                    const docRef = window.doc(window.db, 'addresses', address.id);
                    await window.updateDoc(docRef, {
                        coordinates: coordinates,
                        updatedAt: Date.now()
                    });
                    // Update local data
                    address.coordinates = coordinates;
                    createPin(coordinates, address);
                }
            } catch (error) {
                console.error('Error updating coordinates for address:', address, error);
            }
        }
    }
}

// Format address for geocoding
function formatAddress(address) {
    return `${address.houseNumber} ${address.streetName}, ${address.city}, ${address.state} ${address.zip}`;
}

// Create pin with appropriate icon and popup
function createPin(coordinates, addressInfo) {
    const createColoredIcon = (color) => {
        const hexColor = getHexColor(color);
        return L.divIcon({
            html: `<i class="fas fa-map-marker-alt" style="color: ${hexColor}; font-size: 24px; text-shadow: 2px 2px 2px rgba(0,0,0,0.3);"></i>`,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24],
            className: 'custom-pin'
        });
    };

    const pinColor = getMarkerColor(addressInfo);
    const marker = L.marker([coordinates.lat, coordinates.lon], {
        icon: createColoredIcon(pinColor)
    }).addTo(map);

    markers.push({
        leafletMarker: marker,
        addressInfo: addressInfo
    });

    // Get the most recent history entry for overview info
    const mostRecentEntry = addressInfo.history && addressInfo.history.length > 0 
        ? addressInfo.history[addressInfo.history.length - 1] 
        : null;

    // Create hover popup content with most recent info
    const hoverPopupContent = `
        <div class="popup-content" style="position: relative; min-width: 200px; padding: 5px;">
            ${(mostRecentEntry?.firstName || mostRecentEntry?.lastName) ? 
                `<strong>${[mostRecentEntry.firstName, mostRecentEntry.lastName].filter(Boolean).join(' ')}</strong><br>` : ''}
            ${addressInfo.houseNumber} ${addressInfo.streetName}<br>
            ${addressInfo.city}, ${addressInfo.state} ${addressInfo.zip}<br>
            Last Result: ${mostRecentEntry ? mostRecentEntry.results.join(', ') : ''}
        </div>
    `;

    // Create click popup content
    const clickPopupContent = `
        <div class="popup-content" style="position: relative; min-width: 300px; max-height: 400px; overflow-y: auto; padding: 5px;">
            <div style="position: absolute; top: 5px; right: 5px;">
                <i class="fas fa-trash-alt" 
                   style="color: #ff0000; cursor: pointer; font-size: 16px;"
                   onclick="deleteAddress('${addressInfo.id}', ${marker._leaflet_id})"
                ></i>
            </div>
            <div style="margin-right: 20px;">
                ${addressInfo.houseNumber} ${addressInfo.streetName}<br>
                ${addressInfo.city}, ${addressInfo.state} ${addressInfo.zip}<br>
                <div style="margin-top: 10px;">
                    <strong>History:</strong>
                    ${addressInfo.history ? addressInfo.history.map(entry => {
                        const entryColor = getResultColor(entry.results);
                        return `
                            <div style="margin-top: 5px; padding: 5px; border-radius: 3px; 
                                      background: ${entryColor.background}; 
                                      color: ${entryColor.text};">
                                <div style="text-align: center; margin-bottom: 5px;">
                                    <strong>${new Date(entry.timestamp).toLocaleString()}</strong>
                                </div>
                                ${entry.firstName || entry.lastName ? 
                                    `<strong>Spoke with:</strong> ${[entry.firstName, entry.lastName].filter(Boolean).join(' ')}<br>` : ''}
                                <strong>Result:</strong> ${entry.results.join(', ')}<br>
                                <strong>Visited by:</strong> ${entry.visitedBy}<br>
                                ${entry.comment ? `<strong>Comments:</strong> ${entry.comment}` : ''}
                            </div>
                        `;
                    }).join('') : ''}
                </div>
                <button onclick="addHistoryEntry('${addressInfo.id}')" 
                        style="margin-top: 10px; width: 100%; padding: 5px;">
                    Add New Entry
                </button>
            </div>
        </div>
    `;

    // Create both popups
    const hoverPopup = L.popup({
        closeButton: false,
        autoClose: true,
        className: 'hover-popup'
    }).setContent(hoverPopupContent);

    const clickPopup = L.popup({
        closeButton: true,
        autoClose: false,  // This ensures the popup stays open
        closeOnClick: false, // This prevents closing when clicking the popup
        className: 'click-popup'
    }).setContent(clickPopupContent);

    // Setup marker interactions
    marker.on('mouseover', function() {
        if (!marker.isPopupOpen()) {
            marker.bindPopup(hoverPopup).openPopup();
        }
    });

    marker.on('mouseout', function() {
        if (marker.getPopup() === hoverPopup) {
            marker.closePopup();
        }
    });

    marker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        
        // Close any other open popups
        markers.forEach(m => {
            if (m.leafletMarker !== marker && m.leafletMarker.isPopupOpen()) {
                m.leafletMarker.closePopup();
            }
        });

        // Open the click popup
        marker.unbindPopup();
        marker.bindPopup(clickPopup).openPopup();
    });

    // Add map click handler if not already added
    if (!map.hasClickListener) {
        map.on('click', function(e) {
            markers.forEach(m => {
                if (m.leafletMarker.isPopupOpen()) {
                    m.leafletMarker.closePopup();
                }
            });
        });
        map.hasClickListener = true;
    }
}

// Helper function to convert named colors to hex
function getHexColor(colorName) {
    const colorMap = {
        red: '#FF4040',
        orange: '#FFA500',
        yellow: '#FFD700',
        green: '#40FF40',
        grey: '#808080',
        blue: '#4040FF'
    };
    return colorMap[colorName] || colorMap.blue; // Default to blue if color not found
}

// Add new pin
async function addPin() {
    const fields = ['firstName', 'lastName', 'houseNumber', 'streetName', 'city', 'state', 'zip', 'feedback'];
    const newAddress = {};
    
    // Collect all field values
    for (const field of fields) {
        const value = document.getElementById(field).value.trim();
        if (!value) {
            alert(`Please enter ${field}`);
            return;
        }
        newAddress[field] = value;
    }

    const coordinates = await getCoordinates(formatAddress(newAddress));
    if (!coordinates) {
        alert('Could not find address');
        return;
    }

    try {
        // Save to Firebase and update local data
        await saveAddressData(newAddress);

        // Create pin
        createPin(coordinates, newAddress);

        // Clear form
        fields.forEach(field => {
            document.getElementById(field).value = '';
        });

        // Center map on new marker
        map.setView([coordinates.lat, coordinates.lon], 13);
    } catch (error) {
        alert('Error saving address. Please try again.');
    }
}

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', initMap);

// Convert address to coordinates using Nominatim
async function getCoordinates(address) {
    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search`, {
            params: {
                q: address,
                format: 'json',
                limit: 1
            }
        });
        
        if (response.data && response.data.length > 0) {
            return {
                lat: response.data[0].lat,
                lon: response.data[0].lon
            };
        }
        throw new Error('Address not found');
    } catch (error) {
        console.error('Error geocoding address:', error);
        return null;
    }
}

// Optional: Add confirmation before delete
async function deleteAddress(id, markerId) {
    // Add confirmation dialog
    if (!confirm('Are you sure you want to delete this address and all its history?')) {
        return;
    }

    try {
        // Delete the document from Firebase
        await window.deleteDoc(window.doc(window.db, 'addresses', id));
        
        // Remove from local data
        addressData.addresses = addressData.addresses.filter(addr => addr.id !== id);
        
        // Find and remove the marker
        const markerToRemove = markers.find(m => m.addressInfo.id === id);
        if (markerToRemove) {
            map.removeLayer(markerToRemove.leafletMarker);
        }
        
        // Update markers array
        markers = markers.filter(m => m.addressInfo.id !== id);
        
        // Close any active popup
        if (activePopup) {
            map.closePopup();
            activePopup = null;
        }

    } catch (error) {
        console.error('Error deleting address:', error);
        alert('Error deleting address. Please try again.');
    }
}

// Add this function for reverse geocoding
async function reverseGeocode(lat, lng) {
    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/reverse`, {
            params: {
                format: 'json',
                lat: lat,
                lon: lng
            }
        });
        
        if (response.data) {
            const address = response.data.address;
            return {
                houseNumber: address.house_number || '',
                streetName: address.road || '',
                city: address.city || address.town || '',
                state: address.state || '',
                zip: address.postcode || ''
            };
        }
        throw new Error('Address not found');
    } catch (error) {
        console.error('Error reverse geocoding:', error);
        return null;
    }
}

// Update onMapClick function to fix pin behavior and Comments visibility
async function onMapClick(e) {
    // First check if any marker popups are open
    const openPopups = markers.some(m => m.leafletMarker.isPopupOpen());
    if (openPopups) {
        return; // Don't create new pin popup if a marker popup is open
    }

    // Remove any existing temporary markers and popups
    if (window.tempMarker) {
        map.removeLayer(window.tempMarker);
        window.tempMarker = null;
    }

    const address = await reverseGeocode(e.latlng.lat, e.latlng.lng);
    if (address) {
        // Update hidden fields
        document.getElementById('houseNumber').value = address.houseNumber;
        document.getElementById('streetName').value = address.streetName;
        document.getElementById('city').value = address.city;
        document.getElementById('state').value = address.state;
        document.getElementById('zip').value = address.zip;

        // Create form popup with Comments always visible
        const formContent = `
            <div class="popup-form">
                <select id="tempResults" multiple required>
                    <option value="No Answer">No Answer</option>
                    <option value="Busy">Busy</option>
                    <option value="Shared Gospel">Shared Gospel</option>
                    <option value="Invited to Church">Invited to Church</option>
                    <option value="Attends Another Church">Attends Another Church</option>
                    <option value="Believer">Believer</option>
                    <option value="Requested No Contact">Requested No Contact</option>
                    <option value="No Soliciting">No Soliciting</option>
                    <option value="Follow Up">Follow Up</option>
                    <option value="Limited English">Limited English</option>
                </select>
                <input type="text" id="tempFirstName" placeholder="First Name (optional)">
                <input type="text" id="tempLastName" placeholder="Last Name (optional)">
                <input type="text" id="tempVisitedBy" placeholder="Visited by (required)" required>
                <textarea id="tempComments" placeholder="Comments" rows="3" style="width: 100%; margin-top: 10px;"></textarea>
                <button onclick="saveNewPin(${e.latlng.lat}, ${e.latlng.lng})">Save Pin</button>
            </div>
        `;

        // Create new temporary marker
        window.tempMarker = L.marker(e.latlng).addTo(map);
        window.tempMarker.bindPopup(formContent, {
            closeButton: true,
            closeOnClick: false,
            className: 'temp-popup' // Add this class for styling
        }).openPopup();
    }
}

// Update saveNewPin function to avoid full reload
async function saveNewPin(lat, lng) {
    // Add touch-friendly form handling
    const form = document.querySelector('.popup-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            // Blur any focused input to hide mobile keyboard
            document.activeElement.blur();
        });
    }

    const resultsSelect = document.getElementById('tempResults');
    const results = Array.from(resultsSelect.selectedOptions).map(option => option.value);
    
    if (results.length === 0) {
        alert('Please select at least one result');
        return;
    }

    const firstName = document.getElementById('tempFirstName').value.trim();
    const lastName = document.getElementById('tempLastName').value.trim();
    const visitedBy = document.getElementById('tempVisitedBy').value.trim();
    const comments = document.getElementById('tempComments').value.trim();

    if (!visitedBy) {
        alert('Please enter who visited');
        return;
    }

    const newAddress = {
        houseNumber: document.getElementById('houseNumber').value,
        streetName: document.getElementById('streetName').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        zip: document.getElementById('zip').value,
        coordinates: { lat: lat, lon: lng },
        // Include these for the first entry
        firstName: firstName,
        lastName: lastName,
        results: results,
        visitedBy: visitedBy,
        comments: comments,
        history: [{
            timestamp: Date.now(),
            firstName,
            lastName,
            results,
            visitedBy,
            comment: comments
        }]
    };

    try {
        // Save to Firebase
        const docRef = await saveAddressData(newAddress);
        
        // Remove temporary marker
        if (window.tempMarker) {
            map.removeLayer(window.tempMarker);
            window.tempMarker = null;
        }

        // Create the permanent pin using stored coordinates
        createPin(newAddress.coordinates, { ...newAddress, id: docRef.id });

    } catch (error) {
        console.error('Error saving pin:', error);
        alert('Error saving pin. Please try again.');
    }
}

// Update the toggleMarkerVisibility function
function toggleMarkerVisibility(color) {
    const legendItem = document.querySelector(`.legend-item[data-color="${color}"]`);
    const activeColors = new Set([...visibleColors]);

    if (visibleColors.has(color)) {
        // Removing a color
        visibleColors.delete(color);
        legendItem.classList.add('disabled');
        
        // If no colors are selected, show all colors
        if (visibleColors.size === 0) {
            ['red', 'orange', 'yellow', 'green', 'grey', 'blue'].forEach(c => {
                visibleColors.add(c);
                document.querySelector(`.legend-item[data-color="${c}"]`).classList.remove('disabled');
            });
        }
    } else {
        // Adding a color
        if (visibleColors.size === 6) {
            // If all colors are currently visible, hide all except the selected one
            visibleColors.clear();
            ['red', 'orange', 'yellow', 'green', 'grey', 'blue'].forEach(c => {
                document.querySelector(`.legend-item[data-color="${c}"]`).classList.add('disabled');
            });
        }
        visibleColors.add(color);
        legendItem.classList.remove('disabled');
    }

    // Update markers visibility
    markers.forEach(marker => {
        const markerColor = getMarkerColor(marker.addressInfo);
        if (visibleColors.has(markerColor)) {
            marker.leafletMarker.addTo(map);
        } else {
            map.removeLayer(marker.leafletMarker);
        }
    });
}

// Add helper function to determine marker color
function getMarkerColor(addressInfo) {
    const results = addressInfo.results || [];
    if (results.includes('Requested No Contact')) {
        return 'red';
    } else if (results.includes('Limited English')) {
        return 'orange';
    } else if (results.includes('No Answer')) {
        return 'grey';
    } else if (results.includes('Busy') || 
               results.includes('Attends Another Church') ||
               results.includes('Believer')) {
        return 'yellow';
    } else if (results.includes('Shared Gospel') || 
               results.includes('Invited to Church')) {
        return 'green';
    }
    return 'blue';
}

// Make toggleMarkerVisibility available globally
window.toggleMarkerVisibility = toggleMarkerVisibility;

// Add loading indicator functions
function showLoading() {
    const loader = document.createElement('div');
    loader.id = 'map-loader';
    loader.innerHTML = '<div class="spinner">Loading...</div>';
    document.getElementById('map').appendChild(loader);
}

function hideLoading() {
    const loader = document.getElementById('map-loader');
    if (loader) loader.remove();
}

async function updateExistingRecords() {
    try {
        const querySnapshot = await window.getDocs(window.collection(window.db, 'addresses'));
        
        for (const doc of querySnapshot.docs) {
            const data = doc.data();
            
            // Skip if already has history
            if (data.history) continue;

            // Create initial history entry from existing data
            const history = [];
            if (data.comments || data.results) {
                history.push({
                    timestamp: data.updatedAt || Date.now(),
                    results: data.results || [],
                    comment: data.comments || ''
                });
            }

            // Update document with new structure
            await window.updateDoc(doc.ref, {
                history: history
            });
        }
        
        console.log('Successfully updated existing records');
    } catch (error) {
        console.error('Error updating existing records:', error);
    }
}

// Add these functions to make them globally available
window.addHistoryEntry = addHistoryEntry;
window.saveHistoryEntry = saveHistoryEntry;
window.deleteAddress = deleteAddress;

// Add the history entry functions
async function addHistoryEntry(addressId) {
    // Close any existing popups first
    map.closePopup();
    
    const address = addressData.addresses.find(addr => addr.id === addressId);
    if (!address) return;

    const formContent = `
        <div class="popup-form">
            <input type="text" id="newFirstName" placeholder="First Name" style="width: 100%; margin-bottom: 5px;">
            <input type="text" id="newLastName" placeholder="Last Name" style="width: 100%; margin-bottom: 5px;">
            <select id="newResults" multiple required style="width: 100%; margin-bottom: 5px;">
                <option value="No Answer">No Answer</option>
                <option value="Busy">Busy</option>
                <option value="Shared Gospel">Shared Gospel</option>
                <option value="Invited to Church">Invited to Church</option>
                <option value="Attends Another Church">Attends Another Church</option>
                <option value="Believer">Believer</option>
                <option value="Requested No Contact">Requested No Contact</option>
                <option value="No Soliciting">No Soliciting</option>
                <option value="Follow Up">Follow Up</option>
                <option value="Limited English">Limited English</option>
            </select>
            <input type="text" id="newVisitedBy" placeholder="Visited by" style="width: 100%; margin-bottom: 5px;">
            <textarea id="newComment" placeholder="Comments" rows="3" style="width: 100%; margin-bottom: 10px;"></textarea>
            <button onclick="saveHistoryEntry('${addressId}')" style="width: 100%;">Save Entry</button>
        </div>
    `;

    // Store the new popup in the global activePopup variable
    activePopup = L.popup()
        .setLatLng([address.coordinates.lat, address.coordinates.lon])
        .setContent(formContent)
        .openOn(map);
}

async function saveHistoryEntry(addressId) {
    const results = Array.from(document.getElementById('newResults').selectedOptions).map(opt => opt.value);
    const firstName = document.getElementById('newFirstName').value.trim();
    const lastName = document.getElementById('newLastName').value.trim();
    const visitedBy = document.getElementById('newVisitedBy').value.trim();
    const comment = document.getElementById('newComment').value.trim();
    
    if (results.length === 0) {
        alert('Please select at least one result');
        return;
    }

    if (!visitedBy) {
        alert('Please enter who visited');
        return;
    }

    try {
        const address = addressData.addresses.find(addr => addr.id === addressId);
        if (!address) throw new Error('Address not found');

        const history = address.history || [];
        history.push({
            timestamp: Date.now(),
            firstName,
            lastName,
            results,
            visitedBy,
            comment
        });

        // Update Firebase document
        const docRef = window.doc(window.db, 'addresses', addressId);
        await window.updateDoc(docRef, {
            results: results, // Update current results
            history: history,
            updatedAt: Date.now()
        });

        // Update local data
        address.results = results;
        address.history = history;

        // Refresh the marker
        const marker = markers.find(m => m.addressInfo.id === addressId);
        if (marker) {
            map.removeLayer(marker.leafletMarker);
            createPin(address.coordinates, address);
        }

        map.closePopup();
    } catch (error) {
        console.error('Error saving history entry:', error);
        alert('Error saving entry. Please try again.');
    }
}

// Add a new function to get background and text colors based on results
function getResultColor(results) {
    // Define color schemes with background and text colors
    const colorSchemes = {
        red: { background: '#FFE5E5', text: '#000000' },      // Light red background
        orange: { background: '#FFE9CC', text: '#000000' },   // Light orange background
        yellow: { background: '#FFFAE5', text: '#000000' },   // Light yellow background
        green: { background: '#E5FFE5', text: '#000000' },    // Light green background
        grey: { background: '#F2F2F2', text: '#000000' },     // Light grey background
        blue: { background: '#E5E5FF', text: '#000000' }      // Light blue background
    };

    if (results.includes('Requested No Contact')) {
        return colorSchemes.red;
    } else if (results.includes('Limited English')) {
        return colorSchemes.orange;
    } else if (results.includes('No Answer')) {
        return colorSchemes.grey;
    } else if (results.includes('Busy') || 
               results.includes('Attends Another Church') ||
               results.includes('Believer')) {
        return colorSchemes.yellow;
    } else if (results.includes('Shared Gospel') || 
               results.includes('Invited to Church')) {
        return colorSchemes.green;
    }
    return colorSchemes.blue;
} 