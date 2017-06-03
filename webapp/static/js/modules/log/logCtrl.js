define([
	'angular',
	'moment',
	'lodash'
], function (angular, moment, lodash) {
	'use strict';

	angular.module('log.controller', ['common.cache', 'common.dialog', 'common.upload', 'log.service', 'log.formFactory'])
		.controller('logCtrl', logCtrl);

	logCtrl.$inject = ['$location', '$timeout', '$q', 'Cache', 'dialog', 'upload', 'logService', 'logFormFactory'];
	function logCtrl($location, $timeout, $q, Cache, dialog, upload, logService, logFormFactory) {
		var vm = this,
			counts = {},
			cache = {},
			currentDay,
			dogId,
			today;

		vm.fileTypes = '.jpeg, .jpg, .png, .gif, image/jpeg, image/pjpeg, image/jpeg, image/pjpeg, image/png, image/gif';
		vm.date = {};
		vm.intensities = ['Light', 'Moderate', 'Hard'];
		vm.views = ['img', 'foodChart', 'exerciseChart'];
		vm.view = vm.views[0];
		vm.pieChart = {
			food: {
				title: 'Daily Caloric Intake',
				collect: 'calories',
				name: 'Food',
				metric: 'cal'
			},
			exercise: {
				title: 'Daily Exercise',
				collect: 'duration',
				name: 'Activity',
				metric: 'min'
			}
		};
		vm.notInFuture = notInFuture;
		vm.calculateCalories = calculateCalories;
		
		vm.editLog = editLog;
		vm.cancelLog = cancelLog;
		vm.saveLog = saveLog;
		vm.addLog = addLog;
		vm.deleteLog = deleteLog;
		vm.editWeight = editWeight;
		vm.saveWeight = saveWeight;
		vm.openModal = openModal;
		vm.prev = prev;
		vm.next = next;

		vm.uploadFile = uploadFile;
		init();

		function init() {
			currentDay = $location.url().split('/')[4];
			dogId = $location.url().split('/')[2];
			today = moment();
			
			if (!notInFuture(currentDay)) {
				$location.path('/dog/' + dogId + '/date/' + today.format('MMDDYYYY'));
			}

			counts.food = 0;
			counts.activity = 0;
			cache.food = new Cache();
			cache.exercise = new Cache();
			
			vm.date.prev = moment(currentDay, 'MMDDYYYY').subtract(1, 'day').format('MMDDYYYY');
			vm.date.current = currentDay,
			vm.date.next = moment(currentDay, 'MMDDYYYY').add(1, 'day').format('MMDDYYYY')

			$q.all([getDog(dogId), getLog(), getActivities(), getFoods()]).then(function () {
				angular.element(document.querySelector('#dogPhoto')).bind('change', uploadFile);
			});
		}

		function notInFuture(date) {
			return moment(date, 'MMDDYYYY').isSameOrBefore(today);
		}

		function editLog(type, index) {
			var logItem = vm.log[type][index];
			logItem.edited = true;
			cache[type].setData(angular.copy(logItem), logItem.id);
		}

		function cancelLog(type, index) {
			var logItem = vm.log[type][index];
			delete logItem.edited;
			if (logItem.new) {
				vm.deleteLog(type, index);
			} else {
				vm.log[type][index] = cache[type].getData(logItem.id);
			}
		}

		function getLog() {
			return logService.getLog(dogId, vm.date.current).then(function (response) {
				vm.log = response;
				vm.pieChart.food.total = response.dailyCalories;
				counts.exercise = _.keys(vm.log.exercise).length;
				counts.food = _.keys(vm.log.food).length;
			}, function (error) {
				console.error(error);
			});
		}

		function getDog(dogId) {
			return logService.getDog(dogId).then(function (response) {
				vm.dog = response;
			});
		}

		function getActivities() {
			return logService.getActivities().then(function (response) {
				vm.activities = response;
			});
		}
		function getFoods() {
			return logService.getFoods().then(function (response) {
				vm.foods = response;
			});
		}

		function openModal(type) {
			dialog.popup({}, {
				title: 'Add an ' + capitalize(type),
				messageTemplate: logFormFactory.addNewForm(type),
				buttons: [{
	                label: 'Cancel',
	                cssClass: 'btn-secondary'
	            }, {
	                label: 'Add',
	                cssClass: 'btn-success',
	                ngDisabled: disableAdd(type),
	                actionCallback: addNew(type)
	            }]
			});
		}

		function addNew(type) {
			return function (modalVM) {
				if (!modalVM.item) {
					modalVM.warning = true;
					return;
				}
				logService.addNew(type, modalVM.item).then(function (response) {
					if (response.message) {
						console.error(response.message);
					} 
				});
			}
		}

		function disableAdd(type) {
			return function (modalVM) {
				return !modalVM.item[type];
			}
		}

		function addLog(type) {
			vm.log[type][counts[type]++] = {
				edited: true,
				new: true
			};
		}

		function deleteLog(type, n) {
			counts[type]--;
			var log = vm.log[type][n];
			if (type === 'food') {
				vm.totalCalories -= log.calories;
			} else if (type === 'exercise') {
				vm.totalDuration -= log.duration;
			}
			logService.deleteLog(type, log.id).then(function () {
				delete vm.log[type][n];
				updateLog();
			});
		}

		function updateLog() {
			var noExercise = _.values(vm.log.exercise).length === 0,
				noFood = _.values(vm.log.food).length === 0,
				noWeight = !vm.log.weight;
			if (noExercise && noFood && noWeight && vm.log.id) {
				logService.deleteLog('log', vm.log.id);
			} else if (vm.log.id) {
				logService.updateLog(type, dogId, currentDay, vm.log);
			}
		}

		function saveLog(type, index) {
			logService.saveLog(type, dogId, currentDay, vm.log[type][index]).then(function (response) {
				delete vm.log[type][index].edited;
				delete vm.log[type][index].new;
				vm.log[type][index] = response;
				if (type === 'exercise') {
					calculateDuration(); 
				}
				logService.updateLog(type, dogId, currentDay, vm.log);
			}, function (response) {
				console.error(response);
			});
		}

		function calculateCalories(n) {
			var oldCalories = vm.log.food[n].calories || 0,
				food = _.find(vm.foods, function (food) {
					return food.id == vm.log.food[n].foodId;
				});
			vm.log.food[n].calories = food.calories * (vm.log.food[n].amount || 0) / food.serving;
			vm.log.totalCalories += vm.log.food[n].calories - oldCalories;
		}

		function calculateDuration(n) {
			vm.log.totalDuration = 0;
			_.each(vm.log.exercise, function (exercise) {
				vm.log.totalDuration += exercise.duration;
			});
		}

		function capitalize(string) {
			return string.charAt(0).toUpperCase() + string.slice(1);
		}
		function editWeight() {
			vm.log.edit = true;
			$timeout(function () {
				document.querySelector('#weight').focus();
			});
		}
		function saveWeight() {
			delete vm.log.edit;
			logService.updateWeight(dogId, currentDay, vm.log).then(function (response) {
				angular.merge(vm.log, response);
			});
			if (moment(currentDay).isSame(today)) {
				logService.updateDog(dogId, {weight: vm.log.weight});
			}
		}

		function next() {
			var idx = _.indexOf(vm.views, vm.view) + 1;
			if (idx === vm.views.length) {
				vm.view = vm.views[0];
			} else {
				vm.view = vm.views[idx];
			}
		}

		function prev() {
			var idx = _.indexOf(vm.views, vm.view) - 1;
			if (idx < 0) {
				vm.view = vm.views[vm.views.length - 1];
			} else {
				vm.view = vm.views[idx];
			}
		}

		function uploadFile(event) {
			vm.log.image = event.target.files[0];
			upload.readAsDataUrl(vm.log.image, vm).then(function(result) {
				vm.log.image_url = result;
			});
			logService.updateImage(dogId, currentDay, vm.log).then(function (response) {
				angular.merge(vm.log, response);
			}, function (error) {
				console.error(error);
			});
    	}
	}
});
