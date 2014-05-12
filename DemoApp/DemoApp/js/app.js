
(function () {
    "use strict";

    WinJS.UI.Pages.define("/html/app.html", {
        ready: function (element, options) {
            var localizeButtons = document.querySelectorAll(".localize");
            for (var i = 0; i < localizeButtons.length; i++) {
                localizeButtons[i].addEventListener("click", process, false);
            }
        }
    });

    function setLanguage(lang) {
        Windows.Globalization.ApplicationLanguages.primaryLanguageOverride = lang;
    }

    function process(args) {
        var lang = args.target.dataset.language || "en-US";
        setLanguage(lang);

        WinJS.Resources.processAll();
    }
})();